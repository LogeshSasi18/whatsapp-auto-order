require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 5000;
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.use(cors());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Dummy restaurant data
const restaurant = {
  name: "Demo Food Place",
  address: "123 Main St",
  menu: [
    { id: 1, name: "Parota", price: 30 },
    { id: 2, name: "Chicken Biryani", price: 120 },
    { id: 3, name: "Veg Fried Rice", price: 90 },
  ],
};

let orders = []; // in-memory orders
let clients = []; // SSE clients

// Verify Twilio request (currently bypassed for demo)
function validateTwilioRequest(req) {
  return true;
}

// SSE endpoint for live order updates
app.get("/api/orders/stream", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders();
  clients.push(res);

  req.on("close", () => {
    clients = clients.filter((client) => client !== res);
  });
});

// Send order to SSE clients
function sendNewOrder(order) {
  clients.forEach((client) => client.write(`data: ${JSON.stringify(order)}\n\n`));
}

// Transcribe audio from Twilio Media URL
async function transcribeAudioFromUrl(audioUrl) {
  try {
    console.log("Downloading audio from:", audioUrl);

    const response = await axios.get(audioUrl, {
      responseType: "arraybuffer",
      auth: {
        username: process.env.TWILIO_ACCOUNT_SID,
        password: process.env.TWILIO_AUTH_TOKEN,
      },
      validateStatus: () => true
    });

    const tempPath = path.join(__dirname, "temp.mp3");
    fs.writeFileSync(tempPath, Buffer.from(response.data));
    console.log("Audio saved:", tempPath, fs.statSync(tempPath).size, "bytes");

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempPath),
      model: process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1",
    });

    fs.unlinkSync(tempPath);
    console.log("Transcription text:", transcription.text);
    return transcription.text;
  } catch (err) {
    console.error("Error in transcription:", err.response?.data || err.message);
    return null;
  }
}


// Twilio WhatsApp webhook
app.post("/api/twilio/webhook", async (req, res) => {
  if (!validateTwilioRequest(req)) {
    return res.status(403).send("Invalid Twilio Request");
  }

  const { Body, From, NumMedia, MediaContentType0, MediaUrl0 } = req.body;
  let text = Body?.toLowerCase() || "";

  // If voice message
  if (NumMedia && MediaContentType0 && MediaContentType0.startsWith("audio")) {
    console.log("Voice message detected from:", From);
    const transcribedText = await transcribeAudioFromUrl(MediaUrl0);
    if (transcribedText) {
      console.log("Transcription:", transcribedText);
      text = transcribedText.toLowerCase();
    } else {
      return res.send(`
        <Response>
          <Message>Sorry, we couldn't process your voice message.</Message>
        </Response>
      `);
    }
  }

  // Parse order MSG
  const itemsOrdered = [];
  restaurant.menu.forEach((menuItem) => {
    const regex = new RegExp(`(\\d+)\\s*${menuItem.name.toLowerCase()}`);
    const match = text.match(regex);
    if (match) {
      const qty = parseInt(match[1], 10);
      if (qty > 0) {
        itemsOrdered.push({
          id: menuItem.id,
          name: menuItem.name,
          price: menuItem.price,
          quantity: qty,
          total: menuItem.price * qty,
        });
      }
    }
  });

  if (itemsOrdered.length === 0) {
    return res.send(`
      <Response>
        <Message>
          Sorry, we couldn't detect items in your order. Please send like "1 Parota, 2 Chicken Biryani".
        </Message>
      </Response>
    `);
  }

  // Create order
  const order = {
    id: orders.length + 1,
    from: From,
    items: itemsOrdered,
    totalPrice: itemsOrdered.reduce((a, b) => a + b.total, 0),
    status: "Received",
    createdAt: new Date(),
  };

  orders.push(order);
  sendNewOrder(order);

  return res.send(`
    <Response>
      <Message>
        Thanks! Your order has been placed:
        ${itemsOrdered.map(i => `${i.quantity} x ${i.name}`).join(", ")}.
        Total: ₹${order.totalPrice}
      </Message>
    </Response>
  `);
});

// Restaurant info API
app.get("/api/restaurant", (req, res) => {
  res.json(restaurant);
});


app.listen(PORT, () => {
  console.log(`Backend server listening on http://localhost:${PORT}`);
});


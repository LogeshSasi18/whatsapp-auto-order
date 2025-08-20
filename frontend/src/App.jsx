import React, { useEffect, useState } from "react";

function App() {
  const [restaurant, setRestaurant] = useState(null);
  const [orders, setOrders] = useState([]);

  useEffect(() => {
    fetch("http://localhost:5000/api/restaurant")
      .then(res => res.json())
      .then(setRestaurant);

    const evtSource = new EventSource("http://localhost:5000/api/orders/stream");
    evtSource.onmessage = (e) => {
      const newOrder = JSON.parse(e.data);
      setOrders((prev) => [newOrder, ...prev]);
    };

    return () => evtSource.close();
  }, []);

  if (!restaurant) return <div>Loading restaurant data...</div>;

  return (
    <div  style={{ maxWidth: 600, margin: "auto", fontFamily: "Arial, sans-serif", padding: 20 }}>
      <h1>{restaurant.name}</h1>
      <p>{restaurant.address}</p>

      <h2>Menu</h2>
      <ul>
        {restaurant.menu.map(item => (
          <li key={item.id}>
            {item.name} - ₹{item.price}
          </li>
        ))}
      </ul>

      <h2>Orders Received</h2>
      {orders.length === 0 ? (
        <p>No orders yet.</p>
      ) : (
        <ul>
          {orders.map(order => (
            <li key={order.id} style={{ marginBottom: 15, borderBottom: "1px solid #ccc", paddingBottom: 10 }}>
              <strong>Order #{order.id}</strong> from {order.from}
              <ul>
                {order.items.map((item, i) => (
                  <li key={i}>
                    {item.quantity} × {item.name} = ₹{item.total}
                  </li>
                ))}
              </ul>
              <strong>Total: ₹{order.totalPrice}</strong>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default App;

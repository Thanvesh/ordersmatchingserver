const express = require('express');
const cors = require('cors');
const mysql = require('mysql2');
const db = require('./db');
const app = express();

app.use(cors());
app.use(express.json());

// Place a new order
app.post('/api/order', async (req, res) => {
  const { price, qty, type } = req.body;

  try {
    if (type === 'buyer') {
      await db.promise().query(
        'INSERT INTO pending_orders (buyer_price, buyer_qty, seller_price, seller_qty) VALUES (?, ?, NULL, NULL)',
        [price, qty]
      );
      res.status(201).json({ message: 'Buyer order placed successfully!' });
    } else if (type === 'seller') {
      await db.promise().query(
        'INSERT INTO pending_orders (seller_price, seller_qty, buyer_price, buyer_qty) VALUES (?, ?, NULL, NULL)',
        [price, qty]
      );
      res.status(201).json({ message: 'Seller order placed successfully!' });
    } else {
      res.status(400).json({ error: 'Invalid order type.' });
    }

    // Trigger order matching
    await matchOrder();
  } catch (error) {
    console.error('Error placing order:', error);
    res.status(500).json({ error: 'Error placing order.' });
  }
});

const matchOrder = async () => {
  try {
    // Fetch buyer and seller orders that can be matched
    const [buyerOrders] = await db.promise().query(
      `SELECT * FROM pending_orders WHERE buyer_qty > 0 ORDER BY buyer_price DESC, created_at ASC`
    );

    const [sellerOrders] = await db.promise().query(
      `SELECT * FROM pending_orders WHERE seller_qty > 0 ORDER BY seller_price ASC, created_at ASC`
    );

    // Process matches
    for (let i = 0; i < buyerOrders.length; i++) {
      const buyer = buyerOrders[i];
      if (buyer.buyer_qty <= 0) continue; // Skip if buyer quantity is zero or less

      let remainingBuyerQty = buyer.buyer_qty; // Track remaining quantity for the current buyer order

      for (let j = 0; j < sellerOrders.length; j++) {
        const seller = sellerOrders[j];
        if (seller.seller_qty <= 0) continue; // Skip if seller quantity is zero or less

        // Match if seller's price is less than or equal to buyer's price

        const toFixedFloat = (value, precision = 2) => parseFloat(parseFloat(value).toFixed(precision));

// During matching
        const buyerPrice = toFixedFloat(buyer.buyer_price);
        const sellerPrice = toFixedFloat(seller.seller_price);
       
        if (buyerPrice >= sellerPrice) {
          const matchQty = Math.min(remainingBuyerQty, seller.seller_qty);

          // Use transactions to ensure atomic updates
          await db.promise().query('START TRANSACTION');

          try {
            // Insert matched order into completed_orders
            await db.promise().query(
              'INSERT INTO completed_orders (qty, price) VALUES (?, ?)',
              [matchQty, seller.seller_price]
            );

            // Update buyer and seller quantities
            remainingBuyerQty -= matchQty;
            await db.promise().query(
              'UPDATE pending_orders SET buyer_qty = ? WHERE id = ?',
              [remainingBuyerQty, buyer.id]
            );

            await db.promise().query(
              'UPDATE pending_orders SET seller_qty = ? WHERE id = ?',
              [seller.seller_qty - matchQty, seller.id]
            );

            // Commit transaction if no errors
            await db.promise().query('COMMIT');

            // Remove seller order if fully matched
            if (seller.seller_qty - matchQty === 0) {
              await db.promise().query('DELETE FROM pending_orders WHERE id = ?', [seller.id]);
            }

            // Exit inner loop if buyer's quantity is fully matched
            if (remainingBuyerQty === 0) break;
          } catch (err) {
            // Rollback transaction in case of error
            await db.promise().query('ROLLBACK');
            throw err;
          }
        }
      }

      // Remove buyer order if fully matched
      if (remainingBuyerQty === 0) {
        await db.promise().query('DELETE FROM pending_orders WHERE id = ?', [buyer.id]);
      }
    }
  } catch (err) {
    console.error('Error matching orders:', err);
  }
};


// Get all pending orders
app.get('/api/orders/pending', async (req, res) => {
  try {
    const [results] = await db.promise().query(
      `SELECT buyer_qty, buyer_price, NULL AS seller_price, NULL AS seller_qty FROM pending_orders WHERE buyer_qty > 0
       UNION ALL
       SELECT NULL AS buyer_qty, NULL AS buyer_price, seller_price, seller_qty FROM pending_orders WHERE seller_qty > 0`
    );
    res.json(results);
  } catch (err) {
    console.error('Error fetching pending orders:', err);
    res.status(500).json({ error: 'Error fetching pending orders.' });
  }
});

// Get all completed orders
app.get('/api/orders/completed', async (req, res) => {
  try {
    const [results] = await db.promise().query('SELECT price, SUM(qty) as qty FROM completed_orders GROUP BY price  ORDER BY Price desc');
    res.json(results);
  } catch (err) {
    console.error('Error fetching completed orders:', err);
    res.status(500).json({ error: 'Error fetching completed orders.' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  
  // Run order matching on server startup
  try {
    await matchOrder();
    console.log('Initial order matching completed.');
  } catch (err) {
    console.error('Error during initial order matching:', err);
  }
});




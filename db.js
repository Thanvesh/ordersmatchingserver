const mysql = require('mysql2');

const connection = mysql.createConnection({
  host: 'localhost',  // Your MySQL host
  user: 'root',       // Your MySQL username
  password: 'Thani@1997',       // Your MySQL password
  database: 'order_matching',  // Your MySQL database name
  port:3306,
});

connection.connect((err) => {
  if (err) {
    console.error('Error connecting to MySQL:', err.stack);
    return;
  }
  console.log('Connected to MySQL as id ' + connection.threadId);
});

module.exports = connection;

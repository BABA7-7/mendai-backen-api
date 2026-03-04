// import mysql from "mysql2/promise";

// export const db = mysql.createPool({
//   host: "shinkansen.proxy.rlwy.net",
//   user: "root",
//   password: "mczucwMcsUTXTNwILSjzKhppRsvldzjd",
//   database: "railway",
//   port: 35748 // Use the public port here
// });
import mysql from "mysql2/promise";
import dotenv from "dotenv";

dotenv.config();

// 1. Prioritize the DATABASE_URL (the long mysql:// link)
const connectionString = process.env.DATABASE_URL || "mysql://root:rgAuyrCjNEwYSURMXtyjrmlJfWEOFmcw@switchback.proxy.rlwy.net:36324/railway";

// 2. Create the pool using that string
export const db = mysql.createPool(connectionString);

// 3. IMMEDIATELY test the connection so you see errors in your Render logs
db.getConnection()
  .then((conn) => {
    console.log("✅ Successfully connected to Railway MySQL!");
    conn.release(); // Always release the test connection back to the pool
  })
  .catch((err) => {
    console.error("❌ DATABASE CONNECTION ERROR:", err.message);
  });

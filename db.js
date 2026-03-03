import mysql from "mysql2/promise";

export const db = mysql.createPool({
  host: "shinkansen.proxy.rlwy.net",
  user: "root",
  password: "mczucwMcsUTXTNwILSjzKhppRsvldzjd",
  database: "railway",
  port: 35748 // Use the public port here
});

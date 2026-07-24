
import express from "express";
import moviesRoutes from "./routes/moviesRoutes.js";

const app = express();


//API routes
app.use("/movies", moviesRoutes);

const PORT = 5001;
// app.get("/hello", (req, res) => {
//   res.send("Hello World");
// });

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// http://localhost:5001/hello
// auth/login
// auth/register
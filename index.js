import dotenv from "dotenv";
import express from "express";
import connectDB from "./config/database.js";
import authRouter from "./routes/auth.routes.js";
import courseRouter from "./routes/course.routes.js";

dotenv.config({
    path: ".env",
    override: true,
});

const app = express();

app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));

app.get("/api/health", (_req, res) => {
    res.status(200).json({ success: true, message: "Church API is running" });
});

app.use("/api/auth", authRouter);
app.use("/api/courses", courseRouter);

app.use((req, res) => {
    res.status(404).json({ success: false, message: `Route ${req.method} ${req.originalUrl} not found` });
});

app.use((err, _req, res, _next) => {
    console.error(err);
    if (err.name === "ValidationError" || err.name === "CastError") {
        return res.status(422).json({ success: false, message: "Please provide valid information." });
    }
    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({
        success: false,
        message: statusCode === 500 ? "Something went wrong. Please try again." : err.message,
    });
});


const startServer = async () => {
try{
    await connectDB();
app.on("error", (err) => {
    console.error(`Error: ${err.message}`);
    throw err;
} );
app.listen(process.env.PORT|| 5000,() => {
    console.log(`Server running on port ${process.env.PORT || 5000}`);
} );

}
catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
}
}

startServer();

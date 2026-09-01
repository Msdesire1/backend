/**
 * Server bootstrap: load .env, connect to MongoDB, open GridFS, start listening.
 *
 * The application itself lives in app.js. Splitting them means the routes can be
 * tested without a port or a real database, and it keeps the ordering rule that
 * actually matters visible in one place: GridFS needs a live connection, so
 * `initGridFS()` runs after `connectDB()` resolves and before the first request
 * can arrive.
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import app from "./app.js";
import connectDB from "./config/database.js";
import { initGridFS } from "./config/gridfs.js";

// `quiet` suppresses dotenv's own "injected env (19) from .env" banner — the
// startup log is more useful without it.
dotenv.config({ path: ".env", override: true, quiet: true });

const PORT = Number(process.env.PORT) || 5000;

/**
 * Fail fast on missing secrets rather than at the first login attempt. A server
 * that starts and then 500s on every sign-in is much harder to diagnose than one
 * that refuses to start and says why.
 */
const REQUIRED_ENV = ["MONGODB_URI", "JWT_SECRET", "ADMIN_JWT_SECRET"];

const checkEnvironment = () => {
  const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
  if (missing.length) {
    console.error(`Missing required environment variable(s): ${missing.join(", ")}`);
    console.error("Copy .env.example to .env and fill these in before starting the server.");
    process.exit(1);
  }
  if (process.env.JWT_SECRET === process.env.ADMIN_JWT_SECRET) {
    console.error(
      "JWT_SECRET and ADMIN_JWT_SECRET must differ — sharing them would let a student token pass an admin check.",
    );
    process.exit(1);
  }
};

const startServer = async () => {
  checkEnvironment();

  try {
    await connectDB();
    initGridFS();

    const server = app.listen(PORT, () => {
      console.log(`WOFBI API listening on http://localhost:${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/api/health`);
    });

    server.on("error", (error) => {
      if (error.code === "EADDRINUSE") {
        console.error(`Port ${PORT} is already in use. Set PORT in .env to something else.`);
        process.exit(1);
      }
      console.error(`Server error: ${error.message}`);
      process.exit(1);
    });

    // Finish in-flight requests and close the database cleanly on redeploy.
    const shutdown = (signal) => async () => {
      console.log(`\n${signal} received. Shutting down.`);
      server.close(async () => {
        await mongoose.connection.close();
        process.exit(0);
      });
      // Do not hang forever waiting on a stuck connection.
      setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on("SIGINT", shutdown("SIGINT"));
    process.on("SIGTERM", shutdown("SIGTERM"));
  } catch (error) {
    console.error(`Failed to start: ${error.message}`);
    process.exit(1);
  }
};

startServer();

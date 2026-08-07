import mongoose from "mongoose";

const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 5000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const connectDB = async () => {
    if (!process.env.MONGODB_URI) {
        throw new Error("MONGODB_URI is not defined in the environment.");
    }

    const options = {
        // Fail a single connection attempt after 10s instead of hanging,
        // so our own retry loop stays in control.
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
    };

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const connectionInstance = await mongoose.connect(process.env.MONGODB_URI, options);
            console.log(`MongoDB Connected: ${connectionInstance.connection.host}`);

            // Log (but don't crash on) connection drops after the initial connect.
            mongoose.connection.on("error", (err) => {
                console.error(`MongoDB connection error: ${err.message}`);
            });
            mongoose.connection.on("disconnected", () => {
                console.warn("MongoDB disconnected. Mongoose will attempt to reconnect.");
            });

            return connectionInstance;
        } catch (error) {
            console.error(`MongoDB connection attempt ${attempt}/${MAX_RETRIES} failed: ${error.message}`);

            if (attempt === MAX_RETRIES) {
                throw new Error(`Could not connect to MongoDB after ${MAX_RETRIES} attempts.`);
            }

            console.log(`Retrying in ${RETRY_DELAY_MS / 1000}s...`);
            await sleep(RETRY_DELAY_MS);
        }
    }
};

export default connectDB;

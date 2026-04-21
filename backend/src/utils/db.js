import mongoose from "mongoose";
import { config } from "../config.js";

export const connectDb = async () => {
  if (!config.mongoUri) {
    throw new Error("MONGODB_URI is missing. Please set it in backend/.env");
  }
  await mongoose.connect(config.mongoUri);
  console.log("MongoDB connected successfully");
};

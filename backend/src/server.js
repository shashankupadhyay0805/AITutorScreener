import app from "./app.js";
import { config } from "./config.js";
import { connectDb } from "./utils/db.js";

const start = async () => {
  try {
    await connectDb();
    app.listen(config.port, () => {
      console.log(`Backend listening on port ${config.port}`);
    });
  } catch (error) {
    console.error("Failed to start backend", error);
    process.exit(1);
  }
};

start();

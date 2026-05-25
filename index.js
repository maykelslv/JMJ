// index.js
import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

// Load environment variables
dotenv.config();

const app = express();

const PORT = process.env.PORT || 8000;

// Use MongoDB Atlas connection with database name
const MONGOURL =
  process.env.MONGO_URI ||
  "mongodb+srv://maykellsilva070:cva8l4Pj9am0YYL3@users.blztuf9.mongodb.net/jmj-events";

console.log("MongoDB Connection: Attempting to connect to MongoDB Atlas");
console.log("MongoDB URI:", MONGOURL);
console.log(
  "NOTE: You need to whitelist your IP in MongoDB Atlas for this connection to work"
);
console.log(
  "Visit: https://cloud.mongodb.com > Network Access > Add IP Address > Add Current IP Address"
);

// Handle ES module __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "public")));

// Middleware
// Configure CORS: if FRONTEND_URL is provided, restrict to that origin.
const FRONTEND_URL = process.env.FRONTEND_URL || null;
if (FRONTEND_URL) {
  app.use(cors({ origin: FRONTEND_URL }));
  console.log("CORS origin set to:", FRONTEND_URL);
} else {
  // In development allow all origins
  app.use(cors());
  console.log("CORS: allowing all origins (no FRONTEND_URL set)");
}
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.get("/", (req, res) => {
  console.log("Homepage requested");
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Storage for in-memory form submissions when MongoDB is unavailable
let formSubmissions = [];

// Function to start server with error handling for port in use
const startServer = (port) => {
  const host = process.env.HOST || "0.0.0.0";
  app.listen(port, host)
    .on("listening", () => {
      console.log(`Server running on http://${host}:${port}`);
      // Update the port in form-submit.js to match the actual port
      updateFormSubmitPort(port);
    })
    .on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.error(`Port ${port} is busy. Please free the port and restart the server.`);
      } else {
        console.error("Server error:", err);
      }
    });
};

// Function to update the port in form-submit.js
const updateFormSubmitPort = (port) => {
  try {
    const formSubmitFile = path.join(__dirname, "public", "form-submit.js");

    fs.readFile(formSubmitFile, "utf8", (err, data) => {
      if (err) {
        console.error("Error reading form-submit.js:", err);
        return;
      }

      // Replace the port in the fetch URL
      const updatedData = data.replace(
        /fetch\("http:\/\/localhost:\d+\/register"/,
        `fetch("http://localhost:${port}/register"`
      );

      fs.writeFile(formSubmitFile, updatedData, "utf8", (err) => {
        if (err) {
          console.error("Error updating form-submit.js:", err);
        } else {
          console.log(`Updated form-submit.js to use port ${port}`);
        }
      });
    });
  } catch (error) {
    console.error("Error updating port in form-submit.js:", error);
  }
};

// MongoDB connect with timeout and options
mongoose
  .connect(MONGOURL, {
    serverSelectionTimeoutMS: 5000, // Timeout after 5s
    socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
  })
  .then(() => {
    console.log("✅ Connected to MongoDB Atlas");
    // Start server on fixed port
    startServer(PORT);
  })
  .catch((error) => {
    console.error("MongoDB connection error:", error);
    // Start the server even if MongoDB connection fails, for testing the frontend
    startServer(PORT);
    console.log(`⚠️ Form submissions will be stored in memory temporarily`);
  });

// Schema
const eventSchema = new mongoose.Schema({
  firstName: String,
  lastName: String,
  email: String,
  phone: String,
  eventType: String,
  eventDate: Date,
  guestCount: String,
  specialRequests: String,
});

const Event = mongoose.model("Event", eventSchema);

// Register route
app.post("/register", async (req, res) => {
  try {
    console.log("Received form data:", req.body);

    const {
      firstName,
      lastName,
      email,
      phone,
      eventType,
      eventDate,
      guestCount,
      specialRequests,
    } = req.body;

    if (!firstName || !lastName || !email || !eventDate || !guestCount) {
      console.log("Missing required fields in registration");
      return res.status(400).json({ message: "Missing required fields" });
    }

    const newEvent = {
      firstName,
      lastName,
      email,
      phone: phone || "Not provided",
      eventType: eventType || "wedding",
      eventDate: new Date(eventDate),
      guestCount,
      specialRequests: specialRequests || "None",
      createdAt: new Date(),
    };

    // Check if MongoDB is connected
    if (mongoose.connection.readyState === 1) {
      // Connected to MongoDB
      console.log("Saving event to MongoDB database");
      const eventDoc = new Event(newEvent);
      await eventDoc.save();
      console.log("Event saved successfully, ID:", eventDoc._id);
      res.status(201).json({
        success: true,
        message: "Event registration successful!",
        data: eventDoc,
      });
    } else {
      // Not connected, save in memory
      console.log("MongoDB not connected, storing event in memory");
      formSubmissions.push(newEvent);
      res.status(201).json({
        success: true,
        message: "Event registration stored temporarily!",
        data: newEvent,
        note: "Database connection unavailable. Data stored in memory only.",
      });
    }
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({
      success: false,
      message: "Error processing registration",
      error: err.message,
    });
  }
});

app.get("/api/calendar-availability", async (req, res) => {
  try {
    // Fetch all events from MongoDB
    const events = await Event.find({});

    // Build availability data object
    const availability = {};

    events.forEach(event => {
      const date = new Date(event.eventDate);
      const dateStr = date.toISOString().split("T")[0]; // 'YYYY-MM-DD'

      if (!availability[dateStr]) {
        availability[dateStr] = 1;
      } else {
        availability[dateStr]++;
      }
    });

    // Convert counts into 'booked' or 'limited'
    const formattedAvailability = {};
    for (const [dateStr, count] of Object.entries(availability)) {
      if (count >= 3) {
        formattedAvailability[dateStr] = 'booked';   // Fully booked
      } else {
        formattedAvailability[dateStr] = 'limited';  // Limited availability
      }
    }

    res.json({
      success: true,
      data: formattedAvailability,
    });
  } catch (error) {
    console.error("Error fetching availability data:", error);
    res.status(500).json({
      success: false,
      message: "Error fetching availability data",
      error: error.message,
    });
  }
});

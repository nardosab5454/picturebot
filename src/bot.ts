
import { Telegraf } from "telegraf";
import dotenv from "dotenv";
import sharp from "sharp";
import express from "express";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

dotenv.config();

// Environment variables
const BOT_TOKEN = process.env.BOT_TOKEN;
const RENDER_URL = process.env.RENDER_EXTERNAL_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const PORT = Number(process.env.PORT) || 3000;

if (!BOT_TOKEN || !RENDER_URL || !WEBHOOK_SECRET) {
  throw new Error("Missing required environment variables");
}

// Create Telegram bot
const bot = new Telegraf(BOT_TOKEN);

// Create Express server
const app = express();

// Template paths
const PORTRAIT_TEMPLATE = join(
  process.cwd(),
  "templates",
  "portrait.png"
);

const LANDSCAPE_TEMPLATE = join(
  process.cwd(),
  "templates",
  "landscape.png"
);

// Create downloads folder
async function initialize() {
  await mkdir("downloads", { recursive: true });
}

app.use(express.json());

// Health check
app.get("/", (_req, res) => {
  res.status(200).send("Poster Generator Bot is running!");
});

// Start command
bot.start(async (ctx) => {
  await ctx.reply(
    "Welcome to Poster Generator! 🎨\n\nSend me a photo and I'll create your poster automatically."
  );
});

// Handle incoming photos
bot.on("photo", async (ctx) => {
  try {
    await ctx.reply("Processing your photo... ⏳");

    // Get highest resolution photo
    const photos = ctx.message.photo;
    const photo = photos[photos.length - 1];

    // Download photo from Telegram
    const fileUrl = await ctx.telegram.getFileLink(
      photo.file_id
    );

    const response = await fetch(fileUrl);

    if (!response.ok) {
      throw new Error("Failed to download photo");
    }

    const imageBuffer = Buffer.from(
      await response.arrayBuffer()
    );

    // Correct image orientation
    const normalizedBuffer = await sharp(imageBuffer)
      .rotate()
      .toBuffer();

    // Read image dimensions
    const metadata = await sharp(normalizedBuffer).metadata();

    const width = metadata.width;
    const height = metadata.height;

    if (!width || !height) {
      throw new Error("Unable to read image dimensions");
    }

    // Detect orientation
    const orientation =
      width > height ? "landscape" : "portrait";

    console.log("Image dimensions:", width, "x", height);
    console.log("Orientation:", orientation);

    // Select template
    const templatePath =
      orientation === "landscape"
        ? LANDSCAPE_TEMPLATE
        : PORTRAIT_TEMPLATE;

    // Read template dimensions
    const templateMetadata = await sharp(templatePath).metadata();

    const templateWidth = templateMetadata.width;
    const templateHeight = templateMetadata.height;

    if (!templateWidth || !templateHeight) {
      throw new Error("Invalid template dimensions");
    }

    // Resize background photo
    const backgroundBuffer = await sharp(normalizedBuffer)
      .resize(templateWidth, templateHeight, {
        fit: "cover",
        position: "centre"
      })
      .png()
      .toBuffer();

    // Composite transparent template over photo
    const finalImage = await sharp(backgroundBuffer)
      .composite([
        {
          input: templatePath,
          blend: "over"
        }
      ])
      .jpeg({ quality: 95 })
      .toBuffer();

    // Save generated poster
    const outputFileName = `poster-${Date.now()}.jpg`;

    const outputPath = join(
      "downloads",
      outputFileName
    );

    await writeFile(outputPath, finalImage);

    // Send poster to user
    await ctx.replyWithPhoto(
      {
        source: finalImage,
        filename: outputFileName
      },
      {
        caption: "Your poster is ready! 🎉"
      }
    );

    console.log("Poster generated:", outputPath);

  } catch (error) {
    console.error("Poster generation error:", error);

    await ctx.reply(
      "Sorry! Something went wrong while creating your poster. Please try again."
    );
  }
});

// Handle other messages
bot.on("message", async (ctx) => {
  await ctx.reply(
    "Please send me a photo to create your poster. 📸"
  );
});

// Telegram webhook endpoint
app.post(
  "/telegram",
  bot.webhookCallback("/telegram", {
    secretToken: WEBHOOK_SECRET
  })
);

// Start server and register webhook
async function startServer() {
  try {
    await initialize();

    app.listen(PORT, async () => {
      try {
        const webhookUrl = `${process.env.RENDER_EXTERNAL_URL!.replace(/\/$/, "")}/telegram`;

        await bot.telegram.setWebhook(webhookUrl, {
          secret_token: WEBHOOK_SECRET
        });

        console.log("Poster Generator Bot is running!");
        console.log("Server port:", PORT);
        console.log("Webhook registered:", webhookUrl);

      } catch (error) {
        console.error("Webhook registration failed:", error);
      }
    });

  } catch (error) {
    console.error("Server startup failed:", error);
    process.exit(1);
  }
}

startServer();

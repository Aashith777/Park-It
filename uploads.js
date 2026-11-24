const express = require("express");
const fs = require("fs");
const path = require("path");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

// ------------------------------------------------------------------
// POST /api/uploads/image
// Auth: verified session token
// Body: { imageBase64, filename }
// Decodes a base64 image and saves it locally inside the /uploads directory.
// Returns the public URL to access the image.
// ------------------------------------------------------------------
router.post("/image", requireAuth, async (req, res) => {
  try {
    const { imageBase64, filename } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: "imageBase64 is required" });
    }

    // Clean base64 string
    const matches = imageBase64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    let buffer;
    let fileExtension = ".jpg"; // fallback

    if (matches && matches.length === 3) {
      const type = matches[1];
      buffer = Buffer.from(matches[2], "base64");
      
      // Determine file extension
      if (type.includes("png")) fileExtension = ".png";
      else if (type.includes("webp")) fileExtension = ".webp";
      else if (type.includes("gif")) fileExtension = ".gif";
    } else {
      // Direct raw base64 string
      buffer = Buffer.from(imageBase64, "base64");
    }

    const cleanFilename = `${filename || "upload"}_${Date.now()}${fileExtension}`;
    const uploadsDir = path.join(__dirname, "../uploads");
    const filepath = path.join(uploadsDir, cleanFilename);

    // Save the file
    fs.writeFileSync(filepath, buffer);

    // Build URL (use host header dynamically)
    const host = req.get("host");
    const protocol = req.protocol;
    const url = `${protocol}://${host}/uploads/${cleanFilename}`;

    res.json({
      success: true,
      url,
      filename: cleanFilename,
    });
  } catch (err) {
    console.error("Image upload failed:", err);
    res.status(500).json({ error: "Failed to upload image file" });
  }
});

module.exports = router;

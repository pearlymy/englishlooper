import { onRequest } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import * as os from "os";
import * as path from "path";
import * as fs from "fs";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "@ffmpeg-installer/ffmpeg";
import Busboy from "busboy";

admin.initializeApp();
ffmpeg.setFfmpegPath(ffmpegPath.path);

/**
 * Cloud Function: convertToMp3
 * Accepts WAV upload → converts to MP3 via ffmpeg → returns MP3 binary
 */
export const convertToMp3 = onRequest(
  {
    timeoutSeconds: 300,
    memory: "1GiB",
    cors: true,
  },
  (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method Not Allowed");
      return;
    }

    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `input_${Date.now()}.wav`);
    const outputPath = path.join(tmpDir, `output_${Date.now()}.mp3`);

    const busboy = Busboy({ headers: req.headers });
    let fileReceived = false;

    busboy.on("file", (_fieldname: string, file: NodeJS.ReadableStream, _info: any) => {
      fileReceived = true;
      console.log("Receiving audio file for conversion...");
      const writeStream = fs.createWriteStream(inputPath);
      file.pipe(writeStream);

      writeStream.on("close", () => {
        const inputSize = fs.statSync(inputPath).size;
        console.log(`File received: ${(inputSize / 1024 / 1024).toFixed(1)}MB`);

        ffmpeg(inputPath)
          .toFormat("mp3")
          .audioBitrate(128)
          .audioChannels(2)
          .on("error", (err: Error) => {
            console.error("FFmpeg error:", err);
            cleanup();
            res.status(500).send("Conversion failed: " + err.message);
          })
          .on("end", () => {
            const outputSize = fs.statSync(outputPath).size;
            console.log(`Converted: ${(inputSize / 1024 / 1024).toFixed(1)}MB → ${(outputSize / 1024 / 1024).toFixed(1)}MB MP3`);

            res.set("Content-Type", "audio/mpeg");
            res.set("Content-Length", String(outputSize));
            const readStream = fs.createReadStream(outputPath);
            readStream.pipe(res);
            readStream.on("end", () => cleanup());
          })
          .save(outputPath);
      });
    });

    busboy.on("finish", () => {
      if (!fileReceived) {
        res.status(400).send("No audio file received");
      }
    });

    function cleanup() {
      try { fs.unlinkSync(inputPath); } catch {}
      try { fs.unlinkSync(outputPath); } catch {}
    }

    if (req.rawBody) {
      busboy.end(req.rawBody);
    } else {
      req.pipe(busboy);
    }
  }
);

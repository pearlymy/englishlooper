"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.convertToMp3 = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const fluent_ffmpeg_1 = __importDefault(require("fluent-ffmpeg"));
const ffmpeg_1 = __importDefault(require("@ffmpeg-installer/ffmpeg"));
const busboy_1 = __importDefault(require("busboy"));
admin.initializeApp();
fluent_ffmpeg_1.default.setFfmpegPath(ffmpeg_1.default.path);
/**
 * Cloud Function: convertToMp3
 * Accepts WAV upload → converts to MP3 via ffmpeg → returns MP3 binary
 */
exports.convertToMp3 = (0, https_1.onRequest)({
    timeoutSeconds: 300,
    memory: "1GiB",
    cors: true,
}, (req, res) => {
    if (req.method !== "POST") {
        res.status(405).send("Method Not Allowed");
        return;
    }
    const tmpDir = os.tmpdir();
    const inputPath = path.join(tmpDir, `input_${Date.now()}.wav`);
    const outputPath = path.join(tmpDir, `output_${Date.now()}.mp3`);
    const busboy = (0, busboy_1.default)({ headers: req.headers });
    let fileReceived = false;
    busboy.on("file", (_fieldname, file, _info) => {
        fileReceived = true;
        console.log("Receiving audio file for conversion...");
        const writeStream = fs.createWriteStream(inputPath);
        file.pipe(writeStream);
        writeStream.on("close", () => {
            const inputSize = fs.statSync(inputPath).size;
            console.log(`File received: ${(inputSize / 1024 / 1024).toFixed(1)}MB`);
            (0, fluent_ffmpeg_1.default)(inputPath)
                .toFormat("mp3")
                .audioBitrate(128)
                .audioChannels(2)
                .on("error", (err) => {
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
        try {
            fs.unlinkSync(inputPath);
        }
        catch { }
        try {
            fs.unlinkSync(outputPath);
        }
        catch { }
    }
    if (req.rawBody) {
        busboy.end(req.rawBody);
    }
    else {
        req.pipe(busboy);
    }
});
//# sourceMappingURL=index.js.map
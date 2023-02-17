const EventEmitter = require("events");
const fs = require("fs/promises");
const { once } = require("events");
const path = require("path");
const { createWriteStream, createReadStream } = require("fs");
const { Tail } = require("tail");

const DIRNAME = path.join(__dirname, "..", "logs");

// Handles chunking stdout/stderr by line for pretty printing
class StdBuff extends EventEmitter {
  constructor() {
    super();
    this.buffers = {
      stdout: "",
      stderr: "",
    };
  }
  stdout(msg) {
    const { buffers } = this;
    buffers.stdout += msg.toString();
    const lines = buffers.stdout.split("\n");
    buffers.stdout = lines.pop();
    lines.forEach((line) => this.emit("stdout", line));
  }
  stderr(msg) {
    const { buffers } = this;
    buffers.stderr += msg;
    const lines = buffers.stderr.split("\n");
    buffers.stderr = lines.pop();
    lines.forEach((line) => this.emit("stderr", line));
  }
  flush() {
    if (this.buffers.stdout !== "") {
      this.emit("stdout", this.buffers.stdout);
    }
    if (this.buffers.stderr !== "") {
      this.emit("stderr", this.buffers.stderr);
    }
  }
}

class FileWriterBuff extends StdBuff {
  constructor(filename) {
    super();
    this.path = path.join(DIRNAME, filename);
    this.stream = undefined;
  }
  async open() {
    await fs.mkdir(path.dirname(this.path), { recursive: true });
    await fs.writeFile(this.path, Buffer.alloc(0), "utf-8");
    this.stream = createWriteStream(this.path);
    await once(this.stream, "open");
  }
  stdout(msg) {
    if (!this.stream) {
      throw new Error("write before open");
    }
    const line = JSON.stringify({
      time: Date.now(),
      stdio: "stdout",
      msg: msg.toString(),
    });
    this.stream.write(line + "\n");
  }
  stderr(msg) {
    super.stderr(msg);
    if (!this.stream) {
      throw new Error("write before open");
    }
    const line = JSON.stringify({
      time: Date.now(),
      stdio: "stderr",
      msg: msg.toString(),
    });
    this.stream.write(line + "\n");
  }
  async close() {
    if (!this.stream) {
      throw new Error("close before open");
    }
    new Promise((resolve) => {
      this.stream.close(resolve);
    });
  }
}

class FileReaderBuff extends StdBuff {
  constructor(filename) {
    super();
    this.path = path.join(DIRNAME, filename);
    this.stream = new Tail(this.path, {
      fromBeginning: true,
    });
    this.stream.on("line", (data) => {
      const line = JSON.parse(data.toString());
      if (line.stdio === "stdout") {
        this.emit("stdout", line.msg);
      } else {
        this.emit("stderr", line.msg);
      }
    });
    this.stream.watch();
  }
}

module.exports = { StdBuff, FileWriterBuff, FileReaderBuff };

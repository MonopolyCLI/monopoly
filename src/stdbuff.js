const EventEmitter = require("events");
// Handles chunking stdout/stderr by line for pretty printing
class StdBuff extends EventEmitter {
  constructor(stdout, stderr) {
    super();
    this.buffers = {
      stdout: "",
      stderr: "",
    };
    stdout.on("data", (data) => this.stdout(data.toString()));
    stderr.on("data", (data) => this.stderr(data.toString()));
    stdout.on("close", () => this.emit("stdout", this.buffers.stdout));
    stderr.on("close", () => this.emit("stderr", this.buffers.stderr));
  }
  stdout(msg) {
    const { buffers } = this;
    buffers.stdout += msg;
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
}
module.exports = StdBuff;

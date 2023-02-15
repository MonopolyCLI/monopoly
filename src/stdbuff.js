const EventEmitter = require("events");
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
module.exports = StdBuff;

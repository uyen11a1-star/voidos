// Any fault the emulated machine can raise. The CPU catches these and
// enters the FAULT state; anything else is a real bug and propagates.
export class VoidFault extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'VoidFault';
    this.code = code;
  }
}

// Kernel-level error with a POSIX-like code (EAGAIN, ENOMEM, ESRCH, ENOSYS, EINVAL, ...).
export class KernelError extends Error {
  constructor(code, message) { super(message ?? code); this.name = 'KernelError'; this.code = code; }
}

// export class AppError extends Error {
//   public statusCode: number;

//   constructor(statusCode: number, message: string, stack = "") {
//     super(message); // throw new Error(message)

//     this.statusCode = statusCode;

//     // Custom stack trace(optional)
//     if (stack) {
//       this.stack = stack;
//     } else {
//       Error.captureStackTrace(this, this.constructor);
//     }
//   }
// }

//throw new AppError(404, "Not Found")

export class AppError extends Error {
  public statusCode: number;
  public field?: string;

  constructor(statusCode: number, message: string, field?: string, stack = "") {
    super(message); // throw new Error(message)

    this.statusCode = statusCode;
    this.field = field;

    // Custom stack trace(optional)
    if (stack) {
      this.stack = stack;
    } else {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

//throw new AppError(404, "Not Found")
//throw new AppError(409, "Duplicate", "licenseNumber")

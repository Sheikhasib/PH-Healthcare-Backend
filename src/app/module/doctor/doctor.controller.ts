import { NextFunction, Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { DoctorServices } from "./doctor.service";
import { sendResponse } from "../../utils/sendResponse";
import httpStatus from "http-status";
import { AppError } from "../../utils/AppError";
import { ApplyAsDoctorValidationZodSchema } from "./doctor.validation";

const applyAsDoctor = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const files = req.files as {
      resume?: Express.Multer.File[];
      additionalFiles?: Express.Multer.File[];
    };

    console.log(files);

    const resume = files?.["resume"] ? files?.["resume"][0] : null;
    const additionalFiles = files?.["additionalFiles"] || [];

    const zodValidationResult = ApplyAsDoctorValidationZodSchema.safeParse(
      JSON.parse(req.body.data),
    );

    if (!zodValidationResult.success) {
      throw new AppError(
        httpStatus.BAD_REQUEST,
        zodValidationResult.error.issues[0].message,
      );
    }

    const payload = zodValidationResult.data;

    const result = await DoctorServices.applyAsDoctor(
      payload,
      resume,
      additionalFiles,
    );

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Doctor application submitted successfully",
      data: result,
    });
  },
);

// Verify Doctor Email
const verifyDoctorEmail = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const payload = req.body;

    const result = await DoctorServices.verifyDoctorEmail(payload);

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Doctor Email Verified Successfully",
      data: result,
    });
  },
);

// Approve Doctor
const approveDoctor = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const payload = req.body;
    const user = req.user!;

    const result = await DoctorServices.approveDoctor(payload, user);

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Doctor Approved Successfully",
      data: result,
    });
  },
);

// Get All Doctors
const getAllDoctors = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const { data, meta } = await DoctorServices.getAllDoctors(req.query);

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Doctors fetched successfully",
      data: data,
      meta: meta,
    });
  },
);

export const DoctorController = {
  applyAsDoctor,
  verifyDoctorEmail,
  approveDoctor,
  getAllDoctors,
};

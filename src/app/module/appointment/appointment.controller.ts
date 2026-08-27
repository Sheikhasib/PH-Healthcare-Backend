import { Payment } from "./../../../generated/prisma/browser";
import { NextFunction, Request, Response } from "express";
import { catchAsync } from "../../utils/catchAsync";
import { sendResponse } from "../../utils/sendResponse";
import httpStatus from "http-status";
import { AppointmentServices } from "./appointment.service";

// Book Appointment
const bookAppointment = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const payload = req.body;
    const user = req.user!;

    const result = await AppointmentServices.bookAppointment(payload, user);

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Appointment Payment Initiated Successfully",
      data: result,
    });
  },
);

// Pay Appointment if it is pending
const payAppointment = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const payload = req.body;
    const user = req.user!;

    const result = await AppointmentServices.payAppoinment(payload, user);

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Appointment Payment Initiated Successfully",
      data: result,
    });
  },
);

// Cancel Appointment & Refund Payment
const cancelAppointment = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    const payload = req.body;

    const result = await AppointmentServices.cancelAppointment(payload);

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Appointment Cancelled & Payment Refunded Successfully",
      data: result,
    });
  },
);

// Book Appointment Callback URL
const bookAppointmentCallback = catchAsync(
  async (req: Request, res: Response, next: NextFunction) => {
    console.log("Req.Query: ", req.query);

    const { redirectUrl } = await AppointmentServices.bookAppointmentCallback(
      req.query,
    );

    res.redirect(redirectUrl);

    // sendResponse(res, {
    //   statusCode: httpStatus.OK,
    //   success: true,
    //   message: "Appointment Booked Successfully with payment",
    //   data: result,
    // });
  },
);

export const AppointmentController = {
  bookAppointment,
  payAppointment,
  cancelAppointment,
  bookAppointmentCallback,
};

import { Router } from "express";
import { AppointmentController } from "./appointment.controller";
import { auth } from "../../middleware/checkAuth";
import { Role } from "../../../generated/prisma/enums";

const router = Router();

// Book Appointment route
router.post(
  "/book-appointment",
  auth(Role.PATIENT),
  AppointmentController.bookAppointment,
);

// Pay Appointment route
router.post(
  "/pay-appointment",
  auth(Role.PATIENT),
  AppointmentController.payAppointment,
);

// Cancel Appointment route
router.post(
  "/cancel-appointment",
  auth(Role.PATIENT, Role.ADMIN, Role.SUPER_ADMIN),
  AppointmentController.cancelAppointment,
);

// Book Appointment Callback URL route
router.get(
  "/book-appointment/payment/callback",
  AppointmentController.bookAppointmentCallback,
);

export const AppointmentRoutes = router;

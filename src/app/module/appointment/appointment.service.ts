import {
  AppointmentStatus,
  PaymentStatus,
} from "../../../generated/prisma/enums";
import config from "../../config";
import httpStatus from "http-status";
import { getBkashIdToken } from "../../lib/bKash";
import { prisma } from "../../lib/prisma";
import { AppError } from "../../utils/AppError";
import { RequestUser } from "../../middleware/checkAuth";

// Book Appointment
const bookAppointment = async (payload: any, user: RequestUser) => {
  const transactionResult = await prisma.$transaction(async (tx) => {
    // business logic

    // 1. create an appointment
    const appiotment = await tx.appointment.create({
      data: {
        status: AppointmentStatus.PENDING,
      },
    });

    // 2. create bKash payment
    const bKashIdToken = await getBkashIdToken();

    if (!bKashIdToken) {
      throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, "bKash id token not found");
    }

    console.log(bKashIdToken);

    const bKashCreatePaymentResponse = await fetch(
      `${config.bkash_base_url}/tokenized/checkout/create`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${bKashIdToken}`,
          "X-App-Key": config.bkash_app_key,
        },
        body: JSON.stringify({
          // agreementID: "TokenizedMerchant01L3IKB6H1565072174986", // appointment id
          mode: "0011",
          // payerReference: "01723888888", // user phone or email
          payerReference: user.email, // user phone or email
          callbackURL: `${config.bkash_callback_url}/appointment/book-appointment/payment/callback`, // payment callback url
          // merchantAssociationInfo: "MI05MID54RF09123456One",
          amount: "1200",
          currency: "BDT",
          intent: "sale",
          // merchantInvoiceNumber: "Inv-01", // appointment id
          merchantInvoiceNumber: appiotment.id, // appointment id
        }),
      },
    );

    // get the response status and status text
    console.log(
      "bKash create payment status:",
      bKashCreatePaymentResponse.status,
      bKashCreatePaymentResponse.statusText,
    );

    // get the response json data and log it
    const bKashCreatePaymentResult = await bKashCreatePaymentResponse.json();

    console.log({ bKashCreatePaymentResult });

    // check if the response is ok or not, if not, throw an error
    if (!bKashCreatePaymentResponse.ok) {
      console.error("bKash create payment failed:", bKashCreatePaymentResult);
      throw new AppError(
        httpStatus.BAD_GATEWAY,
        bKashCreatePaymentResult.statusMessage ||
          "Failed to create bKash payment",
      );
    }

    // 3. Payment Model Create
    await tx.payment.create({
      data: {
        // status: bKashCreatePaymentResult.status,
        // amount: bKashCreatePaymentResult.amount,
        amount: "1200",
        // currency: bKashCreatePaymentResult.currency,
        // paymentGateway: bKashCreatePaymentResult.gateway,
        merchantInvoiceNumber: bKashCreatePaymentResult.merchantInvoiceNumber,
        bKashPaymentId: bKashCreatePaymentResult.paymentID,
        // bKashTrxId: bKashCreatePaymentResult.trxID,
        payerReference: user.email,
        // paidAt: bKashCreatePaymentResult.paidAt,
        gatwayResponse: bKashCreatePaymentResult,
        appointmentId: appiotment.id,
      },
    });

    return {
      paymentUrl: bKashCreatePaymentResult.bkashURL,
    };
  });

  return transactionResult;
};

// Pay for the pending Appointment
const payAppoinment = async (payload: any, user: RequestUser) => {
  const appointmentId = payload.appointmentId;

  const existingAppointment = await prisma.appointment.findUnique({
    where: {
      id: appointmentId,
    },
  });

  if (!existingAppointment) {
    throw new AppError(httpStatus.NOT_FOUND, "Appointment not found");
  }

  if (existingAppointment.status !== AppointmentStatus.PENDING) {
    throw new AppError(httpStatus.CONFLICT, "Appointment is not pending");
  }

  // if (
  //   existingAppointment.status === AppointmentStatus.CANCELLED ||
  //   existingAppointment.status === AppointmentStatus.ONGOING ||
  //   existingAppointment.status === AppointmentStatus.COMPLETED
  // ) {
  //   const appointmentStatus = existingAppointment.status;
  //   throw new Error(
  //     `Appointment is already ${appointmentStatus.toLowerCase()}`,
  //   );
  // }

  // 2. create bKash payment
  const bKashIdToken = await getBkashIdToken();

  if (!bKashIdToken) {
    throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, "bKash id token not found");
  }

  console.log(bKashIdToken);

  const bKashCreatePaymentResponse = await fetch(
    `${config.bkash_base_url}/tokenized/checkout/create`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${bKashIdToken}`,
        "X-App-Key": config.bkash_app_key,
      },
      body: JSON.stringify({
        mode: "0011",
        payerReference: user.email, // user phone or email
        callbackURL: `${config.bkash_callback_url}/appointment/book-appointment/payment/callback`, // payment callback url
        amount: "1200",
        currency: "BDT",
        intent: "sale",
        merchantInvoiceNumber: existingAppointment.id, // existing appointment id
      }),
    },
  );

  // get the response status and status text
  console.log(
    "bKash create payment status:",
    bKashCreatePaymentResponse.status,
    bKashCreatePaymentResponse.statusText,
  );

  // get the response json data and log it
  const bKashCreatePaymentResult = await bKashCreatePaymentResponse.json();

  console.log({ bKashCreatePaymentResult });

  // check if the response is ok or not, if not, throw an error
  if (!bKashCreatePaymentResponse.ok) {
    console.error("bKash create payment failed:", bKashCreatePaymentResult);
    throw new AppError(
      httpStatus.BAD_GATEWAY,
      bKashCreatePaymentResult.statusMessage ||
        "Failed to create bKash payment",
    );
  }

  // 2. Payment Model Update
  await prisma.payment.update({
    where: {
      appointmentId: existingAppointment.id,
    },
    data: {
      merchantInvoiceNumber: bKashCreatePaymentResult.merchantInvoiceNumber,
      gatwayResponse: bKashCreatePaymentResult,
      bKashPaymentId: bKashCreatePaymentResult.paymentID,
    },
  });

  return {
    paymentUrl: bKashCreatePaymentResult.bkashURL,
  };
};

// Book Appointment Callback URL
const bookAppointmentCallback = async (query: Record<string, any>) => {
  const transactionResult = await prisma.$transaction(async (tx) => {
    const paymentId = query.paymentID;

    if (!paymentId) {
      throw new AppError(httpStatus.BAD_REQUEST, "paymentId not found");
    }

    // payment status
    const status = query.status;

    // check if the payment is successful, if not, throw an error
    if (!status) {
      throw new AppError(httpStatus.BAD_REQUEST, "payment failed");
    }

    // get bKash id token
    const bKashIdToken = await getBkashIdToken();

    // check if bKash id token is found, if not, throw an error
    if (!bKashIdToken) {
      throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, "bKash id token not found");
    }

    // execute the payment with the payment id
    const executePaymentResponse = await fetch(
      `${config.bkash_base_url}/tokenized/checkout/execute`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${bKashIdToken}`,
          "X-App-Key": config.bkash_app_key,
        },
        body: JSON.stringify({
          paymentID: paymentId,
        }),
      },
    );

    console.log({ executePaymentResponse });

    // convert the response to json
    const excutePaymentResult = await executePaymentResponse.json();

    console.log("bKash execute payment result:", excutePaymentResult);

    // check if the payment is successful / fail / cancel, then, redirect them to the dashboard,
    if (status === "success") {
      // update the appointment status to confirmed into the DB, after successful payment
      await tx.appointment.update({
        where: {
          id: excutePaymentResult.merchantInvoiceNumber, // appointment id used as merchantInvoiceNumber in bKash
        },
        data: {
          status: AppointmentStatus.CONFIRMED,
        },
      });

      // update the payment unfilled data into the DB, after successful payment
      await tx.payment.update({
        where: {
          // appointmentId: excutePaymentResult.merchantInvoiceNumber, // payment id used as merchantInvoiceNumber in bKash
          bKashPaymentId: paymentId,
        },
        data: {
          status: PaymentStatus.PAID,
          bKashTrxId: excutePaymentResult.trxID,
          paidAt: excutePaymentResult.paymentExecuteTime,
          gatwayResponse: excutePaymentResult,
        },
      });

      return {
        redirectUrl: `${config.frontend_url}/dashboard/my-appointment?status=success`,
      };
    } else if (status === "failure") {
      // update the payment status to failed into the DB, after failed payment
      await tx.payment.update({
        where: {
          bKashPaymentId: paymentId,
        },
        data: {
          status: PaymentStatus.FAILED,
          gatwayResponse: excutePaymentResult,
        },
      });

      return {
        redirectUrl: `${config.frontend_url}/dashboard/my-appointment?status=failure`,
      };
    } else if (status === "cancel") {
      // update the payment status to cancelled into the DB, after cancelled payment
      await tx.payment.update({
        where: {
          bKashPaymentId: paymentId,
        },
        data: {
          status: PaymentStatus.CANCELLED,
          gatwayResponse: excutePaymentResult,
        },
      });

      return {
        redirectUrl: `${config.frontend_url}/dashboard/my-appointment?status=cancel`,
      };
    } else {
      // if nothing matches, throw an error
      return {
        excutePaymentResult,
        redirectUrl: `${config.frontend_url}/dashboard/my-appointment?error=payment-failed`,
      };
    }
  });

  return transactionResult;
};

// Book Appointment Callback URL
// const bookAppointmentCallback = async (query: Record<string, any>) => {
//   const paymentId = query.paymentID;

//   if (!paymentId) {
//     throw new Error("paymentId not found");
//   }

//   // payment status
//   const status = query.status;

//   // check if the payment is successful, if not, throw an error
//   if (!status) {
//     throw new Error("payment failed");
//   }

//   // atomic claim: শুধুমাত্র payment এখনো UNPAID থাকলেই এটাকে PROCESSING এ নিয়ে যাও
//   // এটা bKash callback duplicate hit (একই paymentID একাধিকবার আসা) থেকে রক্ষা করে
//   const claim = await prisma.payment.updateMany({
//     where: {
//       bKashPaymentId: paymentId,
//       status: PaymentStatus.UNPAID,
//     },
//     data: {
//       status: PaymentStatus.PROCESSING,
//     },
//   });

//   // claim.count === 0 মানে অন্য একটা duplicate callback রিকোয়েস্ট আগেই এটা claim করে ফেলেছে
//   // তাই আবার bKash execute call না করে, বর্তমান payment status অনুযায়ী redirect করে দাও
//   if (claim.count === 0) {
//     const existingPayment = await prisma.payment.findUnique({
//       where: { bKashPaymentId: paymentId },
//     });

//     const redirectStatusMap: Record<string, string> = {
//       PAID: "success",
//       FAILED: "failure",
//       CANCELLED: "cancel",
//       PROCESSING: "processing",
//     };

//     return {
//       redirectUrl: `${config.frontend_url}/dashboard/my-appointment?status=${
//         redirectStatusMap[existingPayment?.status ?? ""] ?? "unknown"
//       }`,
//     };
//   }

//   const transactionResult = await prisma.$transaction(async (tx) => {
//     // get bKash id token
//     const bKashIdToken = await getBkashIdToken();

//     // check if bKash id token is found, if not, throw an error
//     if (!bKashIdToken) {
//       throw new Error("bKash id token not found");
//     }

//     // execute the payment with the payment id
//     const executePaymentResponse = await fetch(
//       `${config.bkash_base_url}/tokenized/checkout/execute`,
//       {
//         method: "POST",
//         headers: {
//           "Content-Type": "application/json",
//           Accept: "application/json",
//           Authorization: `Bearer ${bKashIdToken}`,
//           "X-App-Key": config.bkash_app_key,
//         },
//         body: JSON.stringify({
//           paymentID: paymentId,
//         }),
//       },
//     );

//     console.log({ executePaymentResponse });

//     // convert the response to json
//     const excutePaymentResult = await executePaymentResponse.json();

//     console.log("bKash execute payment result:", excutePaymentResult);

//     // bKash execute call reject করলে (duplicate, already-called, ইত্যাদি) payment কে FAILED করে দাও
//     // যাতে PROCESSING অবস্থায় আটকে না থাকে
//     if (excutePaymentResult.statusCode !== "0000") {
//       console.error("bKash execute payment rejected:", excutePaymentResult);

//       await tx.payment.update({
//         where: {
//           bKashPaymentId: paymentId,
//         },
//         data: {
//           status: PaymentStatus.FAILED,
//           gatwayResponse: excutePaymentResult,
//         },
//       });

//       return {
//         redirectUrl: `${config.frontend_url}/dashboard/my-appointment?error=payment-execution-failed`,
//       };
//     }

//     // check if the payment is successful / fail / cancel, then, redirect them to the dashboard,
//     if (status === "success") {
//       // update the appointment status to confirmed into the DB, after successful payment
//       await tx.appointment.update({
//         where: {
//           id: excutePaymentResult.merchantInvoiceNumber, // appointment id used as merchantInvoiceNumber in bKash
//         },
//         data: {
//           status: AppointmentStatus.CONFIRMED,
//         },
//       });

//       // update the payment unfilled data into the DB, after successful payment
//       await tx.payment.update({
//         where: {
//           // appointmentId: excutePaymentResult.merchantInvoiceNumber, // payment id used as merchantInvoiceNumber in bKash
//           bKashPaymentId: paymentId,
//         },
//         data: {
//           status: PaymentStatus.PAID,
//           bKashTrxId: excutePaymentResult.trxID,
//           paidAt: excutePaymentResult.paymentExecuteTime,
//           gatwayResponse: excutePaymentResult,
//         },
//       });

//       return {
//         redirectUrl: `${config.frontend_url}/dashboard/my-appointment?status=success`,
//       };
//     } else if (status === "failure") {
//       // update the payment status to failed into the DB, after failed payment
//       await tx.payment.update({
//         where: {
//           bKashPaymentId: paymentId,
//         },
//         data: {
//           status: PaymentStatus.FAILED,
//           gatwayResponse: excutePaymentResult,
//         },
//       });

//       return {
//         redirectUrl: `${config.frontend_url}/dashboard/my-appointment?status=failure`,
//       };
//     } else if (status === "cancel") {
//       // update the payment status to cancelled into the DB, after cancelled payment
//       await tx.payment.update({
//         where: {
//           bKashPaymentId: paymentId,
//         },
//         data: {
//           status: PaymentStatus.CANCELLED,
//           gatwayResponse: excutePaymentResult,
//         },
//       });

//       return {
//         redirectUrl: `${config.frontend_url}/dashboard/my-appointment?status=cancel`,
//       };
//     } else {
//       // if nothing matches, throw an error
//       return {
//         excutePaymentResult,
//         redirectUrl: `${config.frontend_url}/dashboard/my-appointment?error=payment-failed`,
//       };
//     }
//   });

//   return transactionResult;
// };

// Cancel Appointment & Refund Payment
const cancelAppointment = async (payload: any) => {
  const transactionResult = await prisma.$transaction(async (tx) => {
    const appointmentId = payload.appointmentId;

    const existingAppointment = await tx.appointment.findUnique({
      where: {
        id: appointmentId,
      },
      include: {
        payment: true,
      },
    });

    if (!existingAppointment) {
      throw new AppError(httpStatus.NOT_FOUND, "Appointment not found");
    }

    if (
      existingAppointment.status === "ONGOING" ||
      existingAppointment.status === "COMPLETED"
    ) {
      throw new AppError(httpStatus.CONFLICT, "Appointment is already ongoing or completed");
    }

    if (existingAppointment.status === "CANCELLED") {
      throw new AppError(httpStatus.CONFLICT, "Appointment is already cancelled");
    }

    // update the appointment status to cancelled into the DB
    const updatedAppointment = await tx.appointment.update({
      where: {
        id: appointmentId,
      },
      data: {
        status: "CANCELLED",
      },
    });

    const bKashIdToken = await getBkashIdToken();

    if (!bKashIdToken) {
      throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, "bKash id token not found");
    }

    const bKashRefundPaymentResponse = await fetch(
      `${config.bkash_base_url}/tokenized/checkout/payment/refund`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${bKashIdToken}`,
          "X-App-Key": config.bkash_app_key,
        },
        body: JSON.stringify({
          paymentID: existingAppointment.payment?.bKashPaymentId,
          trxID: existingAppointment.payment?.bKashTrxId,
          amount: existingAppointment.payment?.amount.toString(),
          sku: "Appointment Cancellation",
          reason: "Patient cancelled the appointment",
        }),
      },
    );

    const bKashRefundPaymentResult = await bKashRefundPaymentResponse.json();

    console.log(bKashRefundPaymentResult);

    // update the payment refund data into the DB
    const refundPayment = await tx.payment.update({
      where: {
        appointmentId: appointmentId,
      },
      data: {
        refundTrxId: bKashRefundPaymentResult.refundTrxID,
        refundAt: bKashRefundPaymentResult.completedTime,
        refundAmount: bKashRefundPaymentResult.amount,
        refundReason: "Patient cancelled the appointment",
        status: PaymentStatus.REFUNDED,
        gatwayResponse: bKashRefundPaymentResult,
      },
    });

    return {
      appointment: updatedAppointment,
      payment: refundPayment,
    };
  });

  return transactionResult;
};

export const AppointmentServices = {
  bookAppointment,
  payAppoinment,
  bookAppointmentCallback,
  cancelAppointment,
};

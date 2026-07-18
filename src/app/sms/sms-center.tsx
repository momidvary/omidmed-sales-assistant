"use client";

import DeliveryStatusRefresh from "@/components/sms/delivery-status-refresh";
import SingleSmsComposer from "@/components/sms/single-sms-composer";

export default function SmsCenter() {
  return (
    <>
      <SingleSmsComposer
        source="manual"
        defaultText="پیام آزمایشی از دستیار فروش امیدمِد"
      />
      <DeliveryStatusRefresh />
    </>
  );
}

"use client";

import SingleSmsComposer from "@/components/sms/single-sms-composer";

export default function SmsCenter() {
  return (
    <SingleSmsComposer
      source="manual"
      defaultText="پیام آزمایشی از دستیار فروش امیدمِد"
    />
  );
}

import AppShell from "@/components/app-shell";
import AssistantChat from "./assistant-chat";

export default function AssistantPage() {
  const configured = Boolean(process.env.OPENAI_API_KEY);

  return (
    <AppShell
      active="assistant"
      title="دستیار هوش مصنوعی فروش"
      subtitle="از اطلاعات واقعی مشتریان، فاکتورها، محصولات و پیگیری‌ها سؤال کن."
    >
      <AssistantChat configured={configured} />
    </AppShell>
  );
}

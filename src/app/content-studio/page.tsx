import AppShell from "@/components/app-shell";

import PosterStudio from "./poster-studio";

export default function ContentStudioPage() {
  return (
    <AppShell
      active="content-studio"
      title="ساخت پوستر"
      subtitle="عکس محصول را بده، چند جمله درباره‌اش بنویس و پوستر استاتوس واتساپ و اینستاگرام را دانلود کن."
    >
      <PosterStudio />
    </AppShell>
  );
}

import SmoothScroll from "@/components/SmoothScroll";
import MarketingNav from "@/components/MarketingNav";
import Footer from "@/components/Footer";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <SmoothScroll>
      <MarketingNav />
      <main className="relative z-10">{children}</main>
      <Footer />
    </SmoothScroll>
  );
}

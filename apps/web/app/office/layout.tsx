import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "사무실",
  description: "부서별 섹터가 있는 사무실 한 층 — 일이 있는 팀으로 가서 자리에 앉으면 시험이 시작됩니다.",
};

export default function OfficeLayout({ children }: { children: React.ReactNode }) {
  return children;
}

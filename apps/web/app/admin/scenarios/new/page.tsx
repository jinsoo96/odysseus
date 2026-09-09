"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useUser } from "@/components/useUser";
import { Shell } from "@/components/Shell";
import { ScenarioStudio } from "@/components/ScenarioStudio";
import { Spinner } from "@/components/ui";

function NewScenario() {
  const { user, loading } = useUser(["admin"]);
  // 부서 관리 화면의 「새 미션」에서 넘어오면 그 방이 이미 골라져 있다 —
  // 방을 채우러 들어왔는데 부서를 다시 고르게 하면 그건 다른 화면이다.
  const preset = useSearchParams().get("department") ?? "";
  if (loading || !user) return <Spinner />;
  return (
    <Shell user={user} wide>
      <ScenarioStudio initialDepartment={preset} />
    </Shell>
  );
}

export default function NewScenarioPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <NewScenario />
    </Suspense>
  );
}

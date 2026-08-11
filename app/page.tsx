import { redirect } from "next/navigation";
import MedSimplifyApp from "./MedSimplifyApp";
import { isAuthenticated } from "@/lib/auth";

export default async function Home() {
  if (!(await isAuthenticated())) redirect("/login");
  return <MedSimplifyApp />;
}

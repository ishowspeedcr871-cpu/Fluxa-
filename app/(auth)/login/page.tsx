import { loginAction, developerLoginAction } from "@/services/auth/actions";
import { AuthLayout } from "@/layouts/auth-layout";
import { LoginForm } from "./login-form";
import { getCurrentSession } from "@/services/auth/session";
import { redirect } from "next/navigation";

const errorMessages: Record<string, string> = {
  invalid_input: "Enter a valid email and password.",
  invalid_credentials: "Invalid credentials.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string; portal?: string }>;
}) {
  const params = await searchParams;
  const error = params.error ? errorMessages[params.error] : undefined;
  const next = params.next || "/dashboard";
  const boundLoginAction = loginAction.bind(null, next);

  const devNext = (params.next && params.next.startsWith("/developer")) ? params.next : "/developer";
  const boundDeveloperLoginAction = developerLoginAction.bind(null, devNext);

  const defaultTab = (params.next && (params.next.startsWith("/employee") || params.next.startsWith("/organization") || params.next.startsWith("/printers"))) ? "employee" : "user";

  const isCustomerOnly = params.portal === "customer" || params.next?.includes("/customer");

  return (
    <AuthLayout>
      <LoginForm
        boundLoginAction={boundLoginAction}
        boundDeveloperLoginAction={boundDeveloperLoginAction}
        error={error}
        defaultTab={isCustomerOnly ? "user" : defaultTab}
        isCustomerOnly={isCustomerOnly}
      />
    </AuthLayout>
  );
}

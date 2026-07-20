import { loginAction } from "@/services/auth/actions";
import { AuthLayout } from "@/layouts/auth-layout";
import { LoginForm } from "./login-form";

const errorMessages: Record<string, string> = {
  invalid_input: "Enter a valid email and password.",
  invalid_credentials: "Invalid credentials.",
  service_unavailable: "Authentication is temporarily unavailable.",
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

  return (
    <AuthLayout>
      <LoginForm boundLoginAction={boundLoginAction} error={error} />
    </AuthLayout>
  );
}

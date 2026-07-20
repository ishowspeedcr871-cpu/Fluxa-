import { ShieldCheck } from "lucide-react";
import { AuthLayout } from "@/layouts/auth-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { developerLoginAction } from "@/services/auth/actions";

const errorMessages: Record<string, string> = {
  invalid_credentials: "Unable to authenticate with the provided credentials.",
};

export default async function DeveloperLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
  const error = params.error ? errorMessages[params.error] : undefined;
  const next = params.next || "/developer";
  const loginActionWithNext = developerLoginAction.bind(null, next);

  return (
    <AuthLayout>
      <Card className="w-full max-w-md border-accent-magenta/30">
        <CardHeader>
          <div className="mb-4 flex size-12 items-center justify-center rounded-full border border-accent-magenta/30 bg-accent-magenta/10 text-accent-magenta shadow-magenta">
            <ShieldCheck className="size-6" aria-hidden="true" />
          </div>
          <CardTitle>Master Developer access</CardTitle>
          <CardDescription>
            Hidden platform administration entry for authorized FLUXA operators only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form action={loginActionWithNext} className="space-y-4">
            <Input
              name="masterId"
              type="text"
              placeholder="Master ID"
              autoComplete="username"
              required
            />
            <Input
              name="password"
              type="password"
              placeholder="Password"
              autoComplete="current-password"
              required
            />
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            <Button type="submit" className="w-full" variant="primary">
              Enter hidden portal
            </Button>
          </form>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}

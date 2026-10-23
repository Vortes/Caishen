import { SignIn } from "@clerk/nextjs";
import { SHELL_PATH } from "~/components/workspace/routes";

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <SignIn fallbackRedirectUrl={SHELL_PATH} />
    </div>
  );
}

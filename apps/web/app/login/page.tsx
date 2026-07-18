"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import { XCircle } from "lucide-react";
import type { AuthStatus } from "@metamagic/shared";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Label } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [localError, setLocalError] = React.useState<string | null>(null);

  const { data: status, isLoading } = useQuery({
    queryKey: ["auth-status"],
    queryFn: () => api<AuthStatus>("/api/auth/status"),
    staleTime: 0,
  });

  const setupMode = status?.setupRequired ?? false;

  const submit = useMutation({
    mutationFn: () => {
      if (setupMode && password !== confirm) {
        throw new Error("Passwords don't match.");
      }
      return api(setupMode ? "/api/auth/setup" : "/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
    },
    onSuccess: () => router.replace("/"),
    onError: (e) => setLocalError((e as Error).message),
    onMutate: () => setLocalError(null),
  });

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" className="h-16 w-auto" />
          <span className="gradient-text text-2xl font-bold tracking-tight">MetaMagic</span>
        </div>

        {isLoading ? (
          <Skeleton className="h-64" />
        ) : (
          <Card className="glass shadow-primary-glow">
            <CardHeader>
              <CardTitle>{setupMode ? "Create your admin account" : "Sign in"}</CardTitle>
              <CardDescription>
                {setupMode
                  ? "First run — choose the credentials you'll use to access MetaMagic."
                  : "Enter your MetaMagic credentials."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  submit.mutate();
                }}
              >
                <div className="space-y-1.5">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    autoComplete="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete={setupMode ? "new-password" : "current-password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                {setupMode && (
                  <div className="space-y-1.5">
                    <Label htmlFor="confirm">Confirm password</Label>
                    <Input
                      id="confirm"
                      type="password"
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                    />
                  </div>
                )}
                {localError && (
                  <p className="flex items-center gap-2 text-sm text-destructive">
                    <XCircle className="h-4 w-4 shrink-0" /> {localError}
                  </p>
                )}
                <Button
                  type="submit"
                  className="w-full"
                  loading={submit.isPending}
                  disabled={!username || !password}
                >
                  {setupMode ? "Create account" : "Sign in"}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

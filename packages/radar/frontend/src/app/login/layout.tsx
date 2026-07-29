/**
 * Login layout - standalone page without sidebar or header.
 */
export default function LoginLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-secondary)]">
      {children}
    </div>
  );
}

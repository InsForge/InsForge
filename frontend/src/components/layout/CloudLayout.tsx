import { ThemeProvider } from '@/lib/contexts/ThemeContext';

interface CloudLayoutProps {
  children: React.ReactNode;
}

export default function CloudLayout({ children }: CloudLayoutProps) {
  return (
    <ThemeProvider forcedTheme="dark">
      <div className="h-screen bg-neutral-800">{children}</div>
    </ThemeProvider>
  );
}

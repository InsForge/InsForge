interface CloudLayoutProps {
  children: React.ReactNode;
}

export default function CloudLayout({ children }: CloudLayoutProps) {
  return <div className="h-screen bg-neutral-800">{children}</div>;
}

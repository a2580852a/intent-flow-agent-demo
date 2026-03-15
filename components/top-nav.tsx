"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/", label: "概览" },
  { href: "/workspace", label: "任务工作台" },
  { href: "/queue", label: "任务队列" },
  { href: "/admin", label: "后台管理" }
] as const;

export function TopNav() {
  const pathname = usePathname();

  return (
    <nav className="topnav">
      {navItems.map((item) => {
        const isActive = pathname === item.href;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`topnav__link ${isActive ? "topnav__link--active" : ""}`}
            aria-current={isActive ? "page" : undefined}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

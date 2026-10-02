import Image from "next/image";
import logo from "@/assets/logo.png";

type LogoProps = {
  size?: number;
  className?: string;
};

export function Logo({ size = 32, className = "" }: LogoProps) {
  return (
    <Image
      src={logo}
      alt="IRL3"
      height={size}
      width={Math.round((size * logo.width) / logo.height)}
      priority
      className={className}
    />
  );
}

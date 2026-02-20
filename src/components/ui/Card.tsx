import { C } from "../../tokens";

export const Card = ({children, p = 16, style = {}}: any) => (
  <div
    style={{
      background:`linear-gradient(180deg, ${C.s2} 0%, ${C.s1} 100%)`,
      border:`1px solid ${C.border}`,
      borderRadius:14,
      padding:p,
      boxShadow:C.shadow,
      backdropFilter:"blur(6px)",
      transition:"border-color 0.18s ease, box-shadow 0.18s ease, transform 0.18s ease",
      ...style,
    }}
  >
    {children}
  </div>
);

export default function AppButton({
  children,
  onClick,
  type = 'button',
  disabled = false,
  variant = 'solid',
  className = '',
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`button button--${variant} ${className}`.trim()}
    >
      {children}
    </button>
  );
}

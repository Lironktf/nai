export default function FormField({
  label,
  hint,
  multiline = false,
  className = '',
  ...props
}) {
  const InputTag = multiline ? 'textarea' : 'input';
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <InputTag className={`${multiline ? 'textarea' : 'input'} ${className}`.trim()} {...props} />
      {hint ? <span className="field__hint">{hint}</span> : null}
    </label>
  );
}

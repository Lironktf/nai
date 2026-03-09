import { TouchableOpacity, Text } from 'react-native';

type Variant = 'solid' | 'outline' | 'ghost';

interface Props {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  variant?: Variant;
}

export function PrimaryButton({ label, onPress, disabled = false, variant = 'solid' }: Props) {
  const base = 'w-full rounded-xl py-5 items-center justify-center';

  const containerClass = {
    solid: `${base} bg-navy ${disabled ? 'opacity-50' : ''}`,
    outline: `${base} border-2 border-navy ${disabled ? 'opacity-50' : ''}`,
    ghost: `${base} ${disabled ? 'opacity-50' : ''}`,
  }[variant];

  const textClass = {
    solid: 'text-white text-base font-semibold',
    outline: 'text-navy text-base font-semibold',
    ghost: 'text-muted text-base font-medium',
  }[variant];

  return (
    <TouchableOpacity className={containerClass} onPress={onPress} disabled={disabled} activeOpacity={0.8}>
      <Text className={textClass}>{label}</Text>
    </TouchableOpacity>
  );
}

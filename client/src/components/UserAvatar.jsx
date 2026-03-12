export default function UserAvatar({ name, photoUrl, size = 56 }) {
  return (
    <div className="avatar" style={{ width: size, height: size, fontSize: size > 64 ? 28 : 20 }}>
      {photoUrl ? <img src={photoUrl} alt={name} /> : <span>{name?.[0] ?? '?'}</span>}
    </div>
  );
}

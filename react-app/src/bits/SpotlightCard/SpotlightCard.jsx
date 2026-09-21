import { useRef } from 'react';
import './SpotlightCard.css';

// 相比上游多加了一个 ...props 透传：卡片经常需要 onClick / role / aria-* 这类
// 属性，没有透传就只能在外面再套一层 div，多出来的包裹层会破坏 flex 布局。
const SpotlightCard = ({
  children,
  className = '',
  spotlightColor = 'rgba(255, 255, 255, 0.25)',
  ...props
}) => {
  const divRef = useRef(null);

  const handleMouseMove = e => {
    const rect = divRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    divRef.current.style.setProperty('--mouse-x', `${x}px`);
    divRef.current.style.setProperty('--mouse-y', `${y}px`);
    divRef.current.style.setProperty('--spotlight-color', spotlightColor);
  };

  return (
    <div
      ref={divRef}
      onMouseMove={handleMouseMove}
      className={`card-spotlight ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};

export default SpotlightCard;

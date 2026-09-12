import UIKit

/// Fixed heading-up chevron. Camera rotates the map; this stays on the 30-yard line.
final class DrivePuckOverlay: UIView {
    private let chevron = UIView()
    private let pointer = CAShapeLayer()

    override init(frame: CGRect) {
        super.init(frame: frame)
        isUserInteractionEnabled = false
        backgroundColor = .clear
        chevron.isUserInteractionEnabled = false
        chevron.backgroundColor = .clear
        layer.addSublayer(pointer)
        addSubview(chevron)
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    func applyLayout() {
        let size: CGFloat = 28
        let y = bounds.height * 0.70
        chevron.frame = CGRect(x: bounds.midX - size / 2, y: y - size / 2, width: size, height: size)
        let path = UIBezierPath()
        path.move(to: CGPoint(x: size / 2, y: 2))
        path.addLine(to: CGPoint(x: size - 2, y: size - 4))
        path.addLine(to: CGPoint(x: size / 2, y: size * 0.68))
        path.addLine(to: CGPoint(x: 2, y: size - 4))
        path.close()
        pointer.frame = chevron.frame
        pointer.path = path.cgPath
        pointer.fillColor = UIColor(red: 0.10, green: 0.45, blue: 0.91, alpha: 1).cgColor
        pointer.strokeColor = UIColor.white.cgColor
        pointer.lineWidth = 2.5
        pointer.shadowColor = UIColor.black.cgColor
        pointer.shadowOpacity = 0.35
        pointer.shadowOffset = CGSize(width: 0, height: 2)
        pointer.shadowRadius = 3
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        applyLayout()
    }
}

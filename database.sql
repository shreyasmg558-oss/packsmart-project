CREATE DATABASE IF NOT EXISTS packsmart;
USE packsmart;

DROP TABLE IF EXISTS `boxes`;

CREATE TABLE `boxes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `length` decimal(5,1) NOT NULL,
  `width` decimal(5,1) NOT NULL,
  `height` decimal(5,1) NOT NULL,
  `padding` decimal(3,1) NOT NULL DEFAULT 1.0,
  PRIMARY KEY (`id`)
);

INSERT INTO `boxes` (`name`, `length`, `width`, `height`, `padding`) VALUES
-- Extra Small
('Tiny Mailer',            12.0,  8.0,  3.0, 0.5),
('Small Padded Envelope',  18.0, 12.0,  4.0, 0.5),
-- Small
('Small Mailer',           15.0, 10.0,  5.0, 1.0),
('Book Mailer',            28.0, 22.0,  5.0, 1.0),
('Accessory Box',          20.0, 15.0,  8.0, 1.0),
-- Medium
('Medium Flat Box',        30.0, 22.0, 10.0, 1.0),
('Standard Shoe Box',      35.0, 20.0, 12.0, 1.5),
('Medium Square Box',      25.0, 25.0, 25.0, 1.5),
('Laptop Shipping Box',    40.0, 30.0,  8.0, 2.0),
-- Large
('Large Flat Box',         45.0, 35.0, 10.0, 1.5),
('Large Electronics Box',  50.0, 40.0, 20.0, 2.0),
('Tall Box',               30.0, 30.0, 45.0, 1.5),
-- Extra Large
('XL Shipping Carton',     60.0, 50.0, 40.0, 2.0),
('XXL Moving Box',         60.0, 60.0, 50.0, 2.5),
('Oversized Carton',       80.0, 60.0, 40.0, 2.5);
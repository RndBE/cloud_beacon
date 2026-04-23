-- phpMyAdmin SQL Dump
-- version 5.2.2
-- https://www.phpmyadmin.net/
--
-- Host: localhost:3306
-- Generation Time: Apr 06, 2026 at 11:12 AM
-- Server version: 5.5.68-MariaDB
-- PHP Version: 8.3.17

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `db_mqttserver`
--

-- --------------------------------------------------------

--
-- Table structure for table `t_logger`
--

CREATE TABLE `t_logger` (
  `id` int(5) NOT NULL,
  `idlogger` varchar(10) NOT NULL,
  `url_input` text NOT NULL,
  `user` varchar(30) NOT NULL,
  `content_type` text NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8;

--
-- Dumping data for table `t_logger`
--

INSERT INTO `t_logger` (`id`, `idlogger`, `url_input`, `user`, `content_type`) VALUES
(1, '10091', 'https://logger.beacontelemetry.com/datain/add_demo', 'Riset Beacon', 'application/x-www-form-urlencoded'),
(2, '10114', 'https://logger.beacontelemetry.com/datain/add_weatherstation', 'PUPESDM DIY', 'application/x-www-form-urlencoded'),
(3, '10092', 'https://logger.beacontelemetry.com/datain/add_demo', 'Riset Beacon', 'application/x-www-form-urlencoded'),
(4, '10336', 'https://apijastir2.beacontelemetry.com/datamasuk/add_awlr', 'AWLR 1 Jastir 2', 'application/x-www-form-urlencoded'),
(5, '10337', 'https://apijastir2.beacontelemetry.com/datamasuk/add_awlr', 'AWLR 2 Jastir 2', 'application/x-www-form-urlencoded'),
(6, '10338', 'https://apijastir2.beacontelemetry.com/datamasuk/add_awlr', 'AWLR 3 Jastir 2', 'application/x-www-form-urlencoded'),
(7, '10339', 'https://apijastir2.beacontelemetry.com/datamasuk/add_awlr', 'AWLR 4 Jastir 2', 'application/x-www-form-urlencoded'),
(8, '10340', 'https://apijastir2.beacontelemetry.com/datamasuk/add_awlr', 'AWLR 5 Jastir 2', 'application/x-www-form-urlencoded'),
(9, '10341', 'https://apijastir2.beacontelemetry.com/datamasuk/add_awlr', 'AWLR 6 Jastir 2', 'application/x-www-form-urlencoded'),
(10, '10342', 'https://apijastir2.beacontelemetry.com/datamasuk/add_awlr', 'AWLR 7 Jastir 2', 'application/x-www-form-urlencoded'),
(11, '10343', 'https://apijastir2.beacontelemetry.com/datamasuk/add_awlr', 'AWLR 8 Jastir 2', 'application/x-www-form-urlencoded'),
(12, '30001', 'https://apijastir2.beacontelemetry.com/datamasuk/add_awlr?idlogger=30001', 'AWGC Bendung Leuwigoong', 'application/x-www-form-urlencoded'),
(13, '10109', 'https://pusdajatim.monitoring4system.com/datamasuk/add_arr', 'ARR PUSDA Jatim', 'application/x-www-form-urlencoded'),
(14, '10124', 'https://pusdajatim.monitoring4system.com/datamasuk/add_arr', 'ARR Cendono', 'application/x-www-form-urlencoded'),
(15, '10125', 'https://pusdajatim.monitoring4system.com/datamasuk/add_arr', 'ARR Lawang', 'application/x-www-form-urlencoded'),
(16, '10126', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR Dhompo - S. Welang', 'application/x-www-form-urlencoded'),
(17, '10127', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR Selowongko - S. Welang', 'application/x-www-form-urlencoded'),
(18, '10128', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR Purwodadi - S. Welang', 'application/x-www-form-urlencoded'),
(19, '10155', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR Umbulan - Pasuruan', 'application/x-www-form-urlencoded'),
(20, '10156', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR Paguan - S. Sampean', 'application/x-www-form-urlencoded'),
(21, '10157', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR Sentul - S. Asem', 'application/x-www-form-urlencoded'),
(22, '10158', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR Pangilen - S. Kemuning', 'application/x-www-form-urlencoded'),
(23, '10160', 'https://pusdajatim.monitoring4system.com/datamasuk/add_arr', 'ARR Sumberbaru', 'application/x-www-form-urlencoded'),
(24, '10159', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR DAM Samiran', 'application/x-www-form-urlencoded'),
(25, '10161', 'https://pusdajatim.monitoring4system.com/datamasuk/add_arr', 'ARR Ranupane', 'application/x-www-form-urlencoded'),
(26, '10162', 'https://pusdajatim.monitoring4system.com/datamasuk/add_arr', 'ARR Pegantenan', 'application/x-www-form-urlencoded'),
(27, '10163', 'https://pusdajatim.monitoring4system.com/datamasuk/add_arr', 'ARR Karangpenang', 'application/x-www-form-urlencoded'),
(28, '10171', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR DAM Kedungsangku', 'application/x-www-form-urlencoded'),
(29, '10170', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR DAM Jurangdawir', 'application/x-www-form-urlencoded'),
(30, '10164', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR DAM Merawan', 'application/x-www-form-urlencoded'),
(31, '10165', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR DAM Kertosari', 'application/x-www-form-urlencoded'),
(32, '10167', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR DAM Nangger', 'application/x-www-form-urlencoded'),
(33, '10174', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR DAM Kottok', 'application/x-www-form-urlencoded'),
(34, '10168', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR DAM Paingan', 'application/x-www-form-urlencoded'),
(35, '10172', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR DAM Tekung', 'application/x-www-form-urlencoded'),
(36, '10169', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR Brugpurwo', 'application/x-www-form-urlencoded'),
(37, '10166', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR DAM Bago', 'application/x-www-form-urlencoded'),
(38, '10173', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR DAM Kembar', 'application/x-www-form-urlencoded'),
(39, '10184', 'https://pusdajatim.monitoring4system.com/datamasuk/add_arr', 'ARR Krepekan', 'application/x-www-form-urlencoded'),
(40, '10185', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR Srono - K. Bomo Atas', 'application/x-www-form-urlencoded'),
(41, '10189', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR DAM Penewon', 'application/x-www-form-urlencoded'),
(42, '10190', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR DAM Kromong', 'application/x-www-form-urlencoded'),
(43, '10191', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR DAM Gelang Kiri', 'application/x-www-form-urlencoded'),
(44, '10193', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR DAM Dermen', 'application/x-www-form-urlencoded'),
(45, '10192', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR DAM Gelang Kanan', 'application/x-www-form-urlencoded'),
(46, '10194', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR DAM Kadalpang', 'application/x-www-form-urlencoded'),
(47, '10198', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR DAM Sumorobangun', 'application/x-www-form-urlencoded'),
(48, '10196', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR DAM Brangkal', 'application/x-www-form-urlencoded'),
(49, '10197', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR DAM Sewu', 'application/x-www-form-urlencoded'),
(50, '10199', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR DAM Nglirip Kanan', 'application/x-www-form-urlencoded'),
(51, '10200', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR DAM Nglirip Kiri', 'application/x-www-form-urlencoded'),
(52, '10195', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR DAM Guyung', 'application/x-www-form-urlencoded'),
(53, '10225', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awqr', 'AWQR Sidoarjo', 'application/x-www-form-urlencoded'),
(54, '10286', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR Rejoso Hilir', 'application/x-www-form-urlencoded'),
(55, '10287', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR Tellok - S. Blega Madura', 'application/x-www-form-urlencoded'),
(56, '10312', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR Jatiroto', 'application/x-www-form-urlencoded'),
(57, '10313', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR Jompo', 'application/x-www-form-urlencoded'),
(58, '10316', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR Sampang', 'application/x-www-form-urlencoded'),
(59, '10314', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR Banyuputih Situbondo', 'application/x-www-form-urlencoded'),
(60, '10315', 'https://pusdajatim.monitoring4system.com/datamasuk/add_awlr', 'AWLR Bendung Klosod', 'application/x-www-form-urlencoded'),
(61, '10349', 'https://leuwigoong.beacontelemetry.com/datamasuk/add_awgc', 'AWGC Bendung Leuwigoong', 'application/x-www-form-urlencoded'),
(62, '10350', 'https://leuwigoong.beacontelemetry.com/datamasuk/add_awgc', 'AWGC Bendung Leuwigoong 2', 'application/x-www-form-urlencoded'),
(63, '10044', 'https://bbwsso.monitoring4system.com/datamasuk/add_awlr', 'AWLR Karang Talun', 'application/x-www-form-urlencoded'),
(64, '10351', 'https://leuwigoong.beacontelemetry.com/datamasuk/add_baterai', 'Baterai AP', 'application/x-www-form-urlencoded'),
(65, '10345', 'https://bbwsso.monitoring4system.com/datamasuk/add_awlr19', 'AWLR Kaliori', 'application/x-www-form-urlencoded'),
(66, '30002', 'https://demo.monitoring4system.com/datamasuk/add_adr?idlogger=30002', 'AWLR Demo', 'application/x-www-form-urlencoded'),
(67, '30003', 'https://bagong.monitoring4system.com/datamasuk2/add_ews?idlogger=30003', 'EWS Demo', 'application/x-www-form-urlencoded'),
(68, '10347', 'https://bbwsso.monitoring4system.com/datamasuk/add_arr?id_logger=10347', 'ARR Adisana', 'application/x-www-form-urlencoded'),
(69, '10346', 'https://bbwsso.monitoring4system.com/datamasuk/add_awlr19?id_logger=10346', 'AWLR Madurejo', 'application/x-www-form-urlencoded'),
(70, '10348', 'https://bbwsso.monitoring4system.com/datamasuk/add_arr?id_logger=10347', 'ARR Logandeng', 'application/x-www-form-urlencoded'),
(71, '10358', 'https://bbwsso.monitoring4system.com/datamasuk/add_awlr19?id_logger=10358', 'AWLR Ngrancah', 'application/x-www-form-urlencoded'),
(72, '10359', 'https://leuwigoong.beacontelemetry.com/datamasuk/add_awlr', 'AWLR Bendung Leuwigoong', 'application/x-www-form-urlencoded'),
(73, '10352', 'https://leuwigoong.beacontelemetry.com/datamasuk/add_ipcam', 'IPCAM 1', 'application/x-www-form-urlencoded'),
(74, '10353', 'https://leuwigoong.beacontelemetry.com/datamasuk/add_ipcam', 'IPCAM 2', 'application/x-www-form-urlencoded'),
(75, '10354', 'https://leuwigoong.beacontelemetry.com/datamasuk/add_ipcam', 'IPCAM 3', 'application/x-www-form-urlencoded'),
(76, '10355', 'https://leuwigoong.beacontelemetry.com/datamasuk/add_ipcam', 'IPCAM 4', 'application/x-www-form-urlencoded'),
(77, '10356', 'https://leuwigoong.beacontelemetry.com/datamasuk/add_ipcam', 'IPCAM 5', 'application/x-www-form-urlencoded'),
(78, '10357', 'https://leuwigoong.beacontelemetry.com/datamasuk/add_ipcam', 'IPCAM 6', 'application/x-www-form-urlencoded'),
(79, '10344', 'https://bbwsso.monitoring4system.com/datamasuk/add_arr?id_logger=10344', 'ARR Watuagung', 'application/x-www-form-urlencoded'),
(80, '30091', 'https://demo.beacontelemetry.com/datamasuk/add_arr?id_logger=30091', 'ARR Demo', 'application/x-www-form-urlencoded'),
(81, '10360', 'https://mini-stesy.beacontelemetry.com/datamasuk/add_awlr?id_logger=10360', 'AWLR JIAT 1', 'application/x-www-form-urlencoded'),
(82, '10361', 'https://mini-stesy.beacontelemetry.com/datamasuk/add_awlr?id_logger=10361', 'AWLR JIAT 2', 'application/x-www-form-urlencoded'),
(83, '10362', 'https://mini-stesy.beacontelemetry.com/datamasuk/add_awlr?id_logger=10362', 'AWLR JIAT 3', 'application/x-www-form-urlencoded'),
(84, '10363', 'https://mini-stesy.beacontelemetry.com/datamasuk/add_awlr?id_logger=10363', 'AWLR JIAT 4', 'application/x-www-form-urlencoded'),
(85, '10364', 'https://mini-stesy.beacontelemetry.com/datamasuk/add_awlr?id_logger=10364', 'AWLR JIAT 5', 'application/x-www-form-urlencoded'),
(86, '10365', 'https://mini-stesy.beacontelemetry.com/datamasuk/add_awlr?id_logger=10365', 'AWLR JIAT 6', 'application/x-www-form-urlencoded'),
(87, '10093', 'https://logger.beacontelemetry.com/datain/add_demo', 'Riset Beacon', 'application/x-www-form-urlencoded'),
(88, '291', 'https://mini-stesy.beacontelemetry.com/datamasuk/add_aplr?id_logger=20091', 'Demo 1 PT TIS', 'application/x-www-form-urlencoded'),
(89, '292', 'https://mini-stesy.beacontelemetry.com/datamasuk/add_aplr?id_logger=20092', 'Demo 2 PT TIS', 'application/x-www-form-urlencoded'),
(90, '30069', 'https://bms.be-stesy.cloud/api/sensor-data', 'Demo', 'application/json'),
(91, '30070', 'https://bms.be-stesy.cloud/api/sensor-data', 'Demo', 'application/json'),
(92, '30071', 'https://bms.be-stesy.cloud/api/sensor-data', 'Demo', 'application/json'),
(93, '20091', 'https://logger.beacontelemetry.com/datain/add_demo', 'Demo QC 2-01', 'application/x-www-form-urlencoded'),
(94, '20092', 'https://logger.beacontelemetry.com/datain/add_demo', 'Demo QC 2-02', 'application/x-www-form-urlencoded'),
(95, '20093', 'https://logger.beacontelemetry.com/datain/add_demo', 'Demo QC 2-03', 'application/x-www-form-urlencoded'),
(96, '20094', 'https://logger.beacontelemetry.com/datain/add_demo', 'Demo QC 2-04', 'application/x-www-form-urlencoded'),
(97, '20095', 'https://logger.beacontelemetry.com/datain/add_demo', 'Demo QC 2-05', 'application/x-www-form-urlencoded'),
(98, '20096', 'https://logger.beacontelemetry.com/datain/add_demo', 'Demo QC 2-06', 'application/x-www-form-urlencoded'),
(99, '20097', 'https://logger.beacontelemetry.com/datain/add_demo', 'Demo QC 2-07', 'application/x-www-form-urlencoded'),
(100, '20098', 'https://logger.beacontelemetry.com/datain/add_demo', 'Demo QC 2-08', 'application/x-www-form-urlencoded'),
(101, '20099', 'https://logger.beacontelemetry.com/datain/add_demo', 'Demo QC 2-09', 'application/x-www-form-urlencoded'),
(102, '391', 'https://logger.beacontelemetry.com/datain/add_demo', 'Demo QC 3-01', 'application/x-www-form-urlencoded'),
(103, '30092', 'https://logger.beacontelemetry.com/datain/add_demo', 'Demo QC 3-02', 'application/x-www-form-urlencoded'),
(104, '30093', 'https://logger.beacontelemetry.com/datain/add_demo', 'Demo QC 3-03', 'application/x-www-form-urlencoded'),
(105, '30094', 'https://logger.beacontelemetry.com/datain/add_demo', 'Demo QC 3-04', 'application/x-www-form-urlencoded'),
(106, '30095', 'https://logger.beacontelemetry.com/datain/add_demo', 'Demo QC 3-05', 'application/x-www-form-urlencoded'),
(107, '30096', 'https://logger.beacontelemetry.com/datain/add_demo', 'Demo QC 3-06', 'application/x-www-form-urlencoded'),
(108, '30097', 'https://logger.beacontelemetry.com/datain/add_demo', 'Demo QC 3-07', 'application/x-www-form-urlencoded'),
(109, '30098', 'https://logger.beacontelemetry.com/datain/add_demo', 'Demo QC 3-08', 'application/x-www-form-urlencoded'),
(110, '30099', 'https://logger.beacontelemetry.com/datain/add_demo', 'Demo QC 3-09', 'application/x-www-form-urlencoded');

--
-- Indexes for dumped tables
--

--
-- Indexes for table `t_logger`
--
ALTER TABLE `t_logger`
  ADD PRIMARY KEY (`id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `t_logger`
--
ALTER TABLE `t_logger`
  MODIFY `id` int(5) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=111;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;

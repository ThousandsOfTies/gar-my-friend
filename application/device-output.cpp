#include "../firmware/FaceCore.h"
#include "../sources/gar-tools/targets/linux-device/runtime/gc9a01-output/gc9a01_init.h"
#include <algorithm>
#include <array>
#include <cerrno>
#include <cstring>
#include <fcntl.h>
#include <iostream>
#include <linux/gpio.h>
#include <linux/spi/spidev.h>
#include <sstream>
#include <stdexcept>
#include <string>
#include <sys/ioctl.h>
#include <unistd.h>

static void check(bool condition, const char* operation) {
    if (!condition) throw std::runtime_error(std::string(operation)+": "+strerror(errno));
}
struct Wiring {
    std::string spi,chip;unsigned dc=0,hz=0;int reset=-1;
    Wiring(int argc,char** argv){
        if(argc!=9&&argc!=11)throw std::runtime_error("Usage: device-output --spi DEVICE --chip DEVICE --dc LINE --hz SPEED [--reset LINE]");
        bool haveSpi=false,haveChip=false,haveDc=false,haveHz=false;
        for(int i=1;i<argc;i+=2){
            std::string key=argv[i],value=argv[i+1];
            if(key=="--spi"&&!haveSpi){spi=value;haveSpi=true;}
            else if(key=="--chip"&&!haveChip){chip=value;haveChip=true;}
            else if((key=="--dc"&&!haveDc)||(key=="--hz"&&!haveHz)||(key=="--reset"&&reset<0)){
                if(value.empty()||value.find_first_not_of("0123456789")!=std::string::npos)throw std::runtime_error("Invalid numeric device argument");
                unsigned long parsed=std::stoul(value);
                if(key=="--dc"){if(parsed>4095)throw std::runtime_error("Invalid DC line");dc=(unsigned)parsed;haveDc=true;}
                else if(key=="--reset"){if(parsed>4095)throw std::runtime_error("Invalid reset line");reset=(int)parsed;}
                else{if(parsed<1||parsed>100000000)throw std::runtime_error("Invalid SPI speed");hz=(unsigned)parsed;haveHz=true;}
            }else throw std::runtime_error("Unknown or duplicate device argument");
        }
        if(!haveSpi||!haveChip||!haveDc||!haveHz)throw std::runtime_error("Missing device argument");
        if(reset==(int)dc)throw std::runtime_error("Reset and DC lines must differ");
    }
};
struct Surface {
    std::array<uint16_t,240*240> pixels;
    void point(int x,int y,uint16_t color) { if(x>=0&&x<240&&y>=0&&y<240) pixels[y*240+x]=color; }
    void fillEllipse(float cx,float cy,float rx,float ry,uint16_t color) {
        if(rx<=0||ry<=0)return;
        for(int y=std::max(0,(int)std::floor(cy-ry)); y<=std::min(239,(int)std::ceil(cy+ry));++y)
            for(int x=std::max(0,(int)std::floor(cx-rx));x<=std::min(239,(int)std::ceil(cx+rx));++x) {
                float dx=(x+.5f-cx)/rx,dy=(y+.5f-cy)/ry;if(dx*dx+dy*dy<=1)point(x,y,color);
            }
    }
    static float edge(float ax,float ay,float bx,float by,float x,float y){return (x-ax)*(by-ay)-(y-ay)*(bx-ax);}
    void fillTriangle(float ax,float ay,float bx,float by,float cx,float cy,uint16_t color) {
        float area=edge(ax,ay,bx,by,cx,cy);if(std::abs(area)<.0001f)return;
        int left=std::max(0,(int)std::floor(std::min({ax,bx,cx}))),right=std::min(239,(int)std::ceil(std::max({ax,bx,cx})));
        int top=std::max(0,(int)std::floor(std::min({ay,by,cy}))),bottom=std::min(239,(int)std::ceil(std::max({ay,by,cy})));
        for(int y=top;y<=bottom;++y)for(int x=left;x<=right;++x){float e1=edge(ax,ay,bx,by,x+.5f,y+.5f),e2=edge(bx,by,cx,cy,x+.5f,y+.5f),e3=edge(cx,cy,ax,ay,x+.5f,y+.5f);if((e1>=0&&e2>=0&&e3>=0)||(e1<=0&&e2<=0&&e3<=0))point(x,y,color);}
    }
    void line(float ax,float ay,float bx,float by,float width,uint16_t color) {
        float dx=bx-ax,dy=by-ay,length=std::sqrt(dx*dx+dy*dy);int steps=std::max(1,(int)std::ceil(length*2));
        for(int i=0;i<=steps;++i){float t=(float)i/steps;fillEllipse(ax+t*dx,ay+t*dy,width/2,width/2,color);}
    }
};
struct Devices {
    int spi=-1,chip=-1,dc=-1,reset=-1;
    explicit Devices(const Wiring& wiring){
        spi=open(wiring.spi.c_str(),O_WRONLY);check(spi>=0,"open SPI");
        uint8_t mode=0,bits=8;uint32_t hz=wiring.hz;
        check(ioctl(spi,SPI_IOC_WR_MODE,&mode)>=0,"SPI mode");check(ioctl(spi,SPI_IOC_WR_BITS_PER_WORD,&bits)>=0,"SPI bits");check(ioctl(spi,SPI_IOC_WR_MAX_SPEED_HZ,&hz)>=0,"SPI speed");
        chip=open(wiring.chip.c_str(),O_RDONLY);check(chip>=0,"open GPIO");
        gpio_v2_line_request request{};request.offsets[0]=wiring.dc;request.num_lines=1;request.config.flags=GPIO_V2_LINE_FLAG_OUTPUT;strcpy(request.consumer,"GarMyFriend LCD DC");
        check(ioctl(chip,GPIO_V2_GET_LINE_IOCTL,&request)>=0,"request DC line");dc=request.fd;
        if(wiring.reset>=0){
            gpio_v2_line_request rst{};rst.offsets[0]=(unsigned)wiring.reset;rst.num_lines=1;
            rst.config.flags=GPIO_V2_LINE_FLAG_OUTPUT;strcpy(rst.consumer,"GarMyFriend LCD RST");
            rst.config.num_attrs=1;rst.config.attrs[0].attr.id=GPIO_V2_LINE_ATTR_ID_OUTPUT_VALUES;
            rst.config.attrs[0].attr.values=1;rst.config.attrs[0].mask=1;
            check(ioctl(chip,GPIO_V2_GET_LINE_IOCTL,&rst)>=0,"request RST line");reset=rst.fd;
            usleep(20000);pinValue(reset,false);usleep(20000);pinValue(reset,true);usleep(150000);
            gar_gc9a01_initialize(this,[](void* self,uint8_t cmd,const uint8_t* bytes,size_t length){static_cast<Devices*>(self)->command(cmd,bytes,length);return 0;},[](void*,unsigned milliseconds){usleep(milliseconds*1000);});
        }else{
            // The VM starts in a simulated reset state, without a reset wire.
            uint8_t format=0x55,memory=0;command(0x3a,&format,1);command(0x36,&memory,1);
        }
    }
    ~Devices(){for(int fd:{reset,dc,chip,spi})if(fd>=0)close(fd);}
    static void pinValue(int fd,bool value){gpio_v2_line_values values{};values.mask=1;values.bits=value?1:0;check(ioctl(fd,GPIO_V2_LINE_SET_VALUES_IOCTL,&values)>=0,"set LCD GPIO");}
    void dcValue(bool value){pinValue(dc,value);}
    void transfer(const uint8_t* bytes,size_t length){while(length){size_t chunk=std::min(length,(size_t)4096);ssize_t result=write(spi,bytes,chunk);check(result>0,"write SPI");bytes+=result;length-=result;}}
    void command(uint8_t cmd,const uint8_t* data=nullptr,size_t length=0){dcValue(false);transfer(&cmd,1);if(length){dcValue(true);transfer(data,length);}}
    void frame(const Surface& surface){
        const uint8_t window[4]={0,0,0,239};command(0x2a,window,4);command(0x2b,window,4);command(0x2c);dcValue(true);
        std::array<uint8_t,240*240*2> bytes;for(size_t i=0;i<surface.pixels.size();++i){bytes[2*i]=surface.pixels[i]>>8;bytes[2*i+1]=surface.pixels[i]&255;}transfer(bytes.data(),bytes.size());
    }
};
int main(int argc,char** argv){try{
    Wiring wiring(argc,argv);Devices devices(wiring);Surface surface;std::string line;uint64_t frames=0;
    while(std::getline(std::cin,line)){
        std::istringstream input(line);roboface::Pose pose{};roboface::Effects effects;
        input>>pose.eyeRx>>pose.eyeRy>>pose.eyeY>>pose.leftOpen>>pose.rightOpen>>pose.happyEye>>pose.tilt>>pose.mouthY>>pose.mouthW>>pose.mouthCurve>>pose.mouthOpen>>pose.cheek;
        input>>effects.gazeX>>effects.gazeY>>effects.blink>>effects.talkOpen;
        if(!input)throw std::runtime_error("invalid device frame command");
        surface.pixels.fill(roboface::rgb565(roboface::kBackgroundRgb));roboface::render(surface,pose,effects);
        devices.frame(surface);
        ++frames;
        if(frames==1||frames%200==0)std::cerr<<"LCD frames="<<frames<<std::endl;
        std::cout<<"{\"frames\":"<<frames<<",\"spiBytes\":"<<frames*115211<<"}"<<std::endl;
    }
    return 0;
}catch(const std::exception& error){std::cerr<<error.what()<<std::endl;return 1;}}
